"""Murmur's ad detection add-on.

Asks Murmur for the next cached episode, transcribes it in pieces (30 minutes by default) with
Groq's hosted Whisper, or with Vosk on this machine when there's no Groq key or Groq can't be
used right now, sends each piece's transcript to Gemini as text to find the ads, and posts the
ad times back. Optional: if this container is stopped or broken, Murmur plays everything as
usual, just without ad marks.

Settings (environment variables):
  MURMUR_URL       Murmur inside the stack (default http://murmur:3000)
  ADDON_SECRET     same value as Murmur's ADDON_SECRET (required)
  GEMINI_API_KEY   required
  GEMINI_MODEL     default gemini-flash-lite-latest, which follows Google's newest Flash-Lite
  GEMINI_RPM / GEMINI_TPM / GEMINI_RPD   limits this add-on keeps under (default 10 / 200000 / 400)
  GROQ_API_KEY     optional; much better transcripts and no transcription load on this machine
  GROQ_MODEL       default whisper-large-v3-turbo
  GROQ_AUDIO_PER_HOUR / GROQ_AUDIO_PER_DAY   seconds of audio this add-on sends Groq at most
                   (default 7200 / 28800, Groq's free tier)
  CHUNK_MINUTES    transcript piece length (default 30)
"""

import json
import logging
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION = os.environ.get("ADSCAN_VERSION", "dev")
MURMUR_URL = os.environ.get("MURMUR_URL", "http://murmur:3000").rstrip("/")
SECRET = os.environ.get("ADDON_SECRET", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
RPM = int(os.environ.get("GEMINI_RPM", "10"))
TPM = int(os.environ.get("GEMINI_TPM", "200000"))
RPD = int(os.environ.get("GEMINI_RPD", "400"))
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3-turbo")
GROQ_PER_HOUR = int(os.environ.get("GROQ_AUDIO_PER_HOUR", "7200"))
GROQ_PER_DAY = int(os.environ.get("GROQ_AUDIO_PER_DAY", "28800"))
# Waiting longer than this for Groq's hourly allowance isn't worth it; Vosk does the piece instead.
GROQ_MAX_WAIT_SEC = 15 * 60
CHUNK_SEC = float(os.environ.get("CHUNK_MINUTES", "30")) * 60
OVERLAP_SEC = 120
CACHE = Path(os.environ.get("CACHE_DIR", "/cache"))
STATE = Path(os.environ.get("STATE_DIR", "/state"))
VOSK_MODEL = os.environ.get("VOSK_MODEL", "/models/vosk-model-small-en-us-0.15")
IDLE_SEC = 60
MAX_AD_SEC = 300
# Gemini's daily quota resets at midnight Pacific time.
PACIFIC = ZoneInfo("America/Los_Angeles")

AD_RULES = (
    "List every advertisement in it: ads inserted by the host platform, sponsor reads by the "
    "hosts, and promos for other podcasts or products. Leave out the show's own intro and outro "
    "and requests to rate, subscribe or join the show's membership. kind is one of inserted, "
    "host_read or promo. advertiser is the brand, or empty if none is named. first_words is "
    "the first few words of the ad."
)

# The Gemini library warns on every answer that it skipped the model's thinking parts; harmless noise.
logging.getLogger("google_genai.types").setLevel(logging.ERROR)


def log(msg: str, **fields) -> None:
    print(json.dumps({"t": datetime.now().isoformat(timespec="seconds"), "msg": msg, **fields}), flush=True)


class Paused(Exception):
    """Gemini can't be used for a while (daily limit, repeated failures)."""

    def __init__(self, seconds: float, reason: str):
        super().__init__(reason)
        self.seconds = max(60, int(seconds))
        self.reason = reason


class ConfigError(Exception):
    """Gemini refuses the key, billing or model; only a settings change fixes it."""


class ScanGone(Exception):
    """Murmur no longer has this scan (the episode left the cache)."""


class BadAnswer(Exception):
    pass


# ---------- Murmur ----------

def murmur(path: str, body: dict | None = None) -> dict:
    """POSTs to Murmur. Waits out Murmur being down (results are kept until it's back)."""
    delay = 10
    failed = False
    while True:
        req = urllib.request.Request(
            MURMUR_URL + path,
            data=json.dumps(body or {}).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                if failed:
                    log("reached Murmur")
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 404 and path.startswith("/api/addon/ads/") and not path.endswith("/next"):
                raise ScanGone() from e
            if e.code in (401, 404):
                log("Murmur refused the add-on; check ADDON_SECRET is the same on both", status=e.code)
            elif e.code < 500:
                raise
        except (urllib.error.URLError, OSError) as e:
            log("can't reach Murmur, retrying", error=str(e), in_sec=delay)
        failed = True
        time.sleep(delay)
        delay = min(300, delay * 2)


status = {"state": "ok", "message": None}
last_beat = 0.0
# Until Murmur has heard this, it still thinks the previous run is scanning (see `started`).
announced = False


def heartbeat(force: bool = False) -> None:
    global last_beat, announced
    if not force and time.monotonic() - last_beat < 60:
        return
    last_beat = time.monotonic()
    try:
        murmur("/api/addon/status", {"version": VERSION, **status, "geminiRequestsToday": budget.requests_today(),
                                     "groq": groq_allowance.problem(), "started": not announced})
        announced = True
    except Exception as e:  # a missed heartbeat only makes Settings show "not connected"
        log("heartbeat failed", error=str(e))


def set_status(state: str, message: str | None) -> None:
    if status["state"] != state or status["message"] != message:
        status.update(state=state, message=message)
        log("status", state=state, message=message)
        heartbeat(force=True)


# ---------- Gemini pacing ----------

def seconds_to_pacific_midnight() -> float:
    now = datetime.now(PACIFIC)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)
    return (midnight - now).total_seconds()


class Budget:
    """Keeps Gemini use under the per-minute and per-day limits, so 429s are rare."""

    def __init__(self) -> None:
        self.recent: deque[tuple[float, int]] = deque()
        self.file = STATE / "usage.json"
        self.day, self.count = "", 0
        try:
            saved = json.loads(self.file.read_text())
            self.day, self.count = saved["day"], saved["requests"]
        except (OSError, ValueError, KeyError):
            pass
        self.paused_until = 0.0
        self.pause_reason = ""

    def today(self) -> str:
        return datetime.now(PACIFIC).date().isoformat()

    def requests_today(self) -> int:
        return self.count if self.day == self.today() else 0

    def pause(self, seconds: float, reason: str) -> None:
        self.paused_until = time.time() + seconds
        self.pause_reason = reason

    def before_call(self, tokens: int) -> None:
        if time.time() < self.paused_until:
            raise Paused(self.paused_until - time.time(), self.pause_reason)
        if self.requests_today() >= RPD:
            raise Paused(seconds_to_pacific_midnight(), "Daily Gemini limit reached")
        while True:
            now = time.monotonic()
            while self.recent and now - self.recent[0][0] > 60:
                self.recent.popleft()
            used = sum(t for _, t in self.recent)
            if len(self.recent) < RPM and used + tokens <= TPM:
                return
            time.sleep(max(1, 61 - (now - self.recent[0][0])))

    def record(self, tokens: int) -> None:
        self.recent.append((time.monotonic(), tokens))
        if self.day != self.today():
            self.day, self.count = self.today(), 0
        self.count += 1
        try:
            self.file.write_text(json.dumps({"day": self.day, "requests": self.count}))
        except OSError:
            pass


budget = Budget()
_client = None


def gemini_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=GEMINI_KEY)
    return _client


def parse_clock(value: str) -> float:
    value = value.strip()
    if ":" not in value:
        return float(value)
    total = 0.0
    for part in value.split(":"):
        total = total * 60 + float(part)
    return total


def ask_gemini(prompt: str) -> list[dict]:
    """Ads in one transcript piece. Retries what's worth retrying; raises Paused or ConfigError otherwise."""
    import httpx
    from google.genai import errors, types
    from pydantic import BaseModel

    class Ad(BaseModel):
        start: str
        end: str
        kind: str
        advertiser: str
        first_words: str

    class Ads(BaseModel):
        ads: list[Ad]

    estimate = len(prompt) // 3
    bad_answers = 0
    for attempt in range(5):
        budget.before_call(estimate)
        try:
            res = gemini_client().models.generate_content(
                model=GEMINI_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Ads, temperature=0),
            )
            budget.record((res.usage_metadata and res.usage_metadata.prompt_token_count) or estimate)
            try:
                parsed = Ads.model_validate_json(res.text or "")
                return [
                    {"startSec": parse_clock(a.start), "endSec": parse_clock(a.end), "kind": a.kind,
                     "advertiser": a.advertiser or None, "firstWords": a.first_words or None}
                    for a in parsed.ads
                ]
            except ValueError as e:
                raise BadAnswer(str(e)) from e
        except errors.APIError as e:
            text = str(e)
            if e.code == 429:
                if "PerDay" in text or "per day" in text.lower():
                    raise Paused(seconds_to_pacific_midnight(), "Daily Gemini limit reached") from e
                m = re.search(r"retryDelay['\"]?:\s*['\"](\d+)", text)
                delay = int(m.group(1)) + 1 if m else backoff(attempt)
            elif e.code in (500, 502, 503, 504):
                delay = backoff(attempt)
            elif e.code in (400, 401, 403, 404):
                raise ConfigError(f"Gemini answered {e.code}: {getattr(e, 'message', None) or text[:200]}") from e
            else:
                raise
            log("Gemini busy, retrying", code=e.code, in_sec=round(delay))
        except (httpx.HTTPError, OSError) as e:
            delay = backoff(attempt)
            log("Gemini unreachable, retrying", error=str(e), in_sec=round(delay))
        except BadAnswer as e:
            bad_answers += 1
            if bad_answers > 1:
                raise
            log("Gemini's answer didn't parse, asking again", error=str(e)[:200])
            continue
        time.sleep(delay)
    raise Paused(30 * 60, "Gemini kept failing; trying again later")


def backoff(attempt: int) -> float:
    return min(300, 15 * 2 ** attempt) * random.uniform(0.8, 1.2)


# ---------- Transcription ----------

_model = None


def vosk_model():
    global _model
    if _model is None:
        from vosk import Model, SetLogLevel

        SetLogLevel(-1)
        _model = Model(VOSK_MODEL)
    return _model


def duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


class GroqAllowance:
    """Seconds of audio sent to Groq in the last hour and day, kept under its limits. Saved in
    /state so a restart doesn't forget what was used."""

    def __init__(self) -> None:
        self.sent: deque[tuple[float, float]] = deque()
        self.blocked_until = 0.0
        # A refused key; tried again after `recheck_at`, so fixing it doesn't need a restart.
        self.disabled: str | None = None
        self.recheck_at = 0.0
        self.file = STATE / "groq.json"
        try:
            saved = json.loads(self.file.read_text())
            now = time.time()
            self.sent.extend((t, sec) for t, sec in saved.get("sent", []) if now - t < 86400)
            self.blocked_until = float(saved.get("blockedUntil", 0))
        except (OSError, ValueError, TypeError):
            pass

    def save(self) -> None:
        try:
            self.file.write_text(json.dumps({"sent": list(self.sent), "blockedUntil": self.blocked_until}))
        except OSError:
            pass

    def block(self, seconds: float) -> None:
        self.blocked_until = time.time() + seconds
        self.save()
        heartbeat(force=True)

    def refuse(self, code: int) -> None:
        self.disabled = f"Groq refused the key ({code}). Checking again hourly"
        self.recheck_at = time.time() + 3600
        heartbeat(force=True)

    def used(self, window: float) -> float:
        now = time.time()
        return sum(sec for t, sec in self.sent if now - t < window)

    def frees_at(self, window: float, limit: float, seconds: float) -> float | None:
        """When enough audio sent in the last `window` ages out to send `seconds` more."""
        need = self.used(window) + seconds - limit
        if need <= 0:
            return time.time()
        freed, now = 0.0, time.time()
        for t, sec in self.sent:
            if now - t < window:
                freed += sec
                if freed >= need:
                    return t + window + 5
        return None

    def problem(self) -> dict | None:
        """Why pieces go to Vosk instead of Groq right now, for Settings; None when Groq is usable
        (or not set up, which is a choice, not a problem)."""
        if not GROQ_KEY:
            return None
        if self.disabled:
            return {"problem": self.disabled, "until": None}
        if time.time() < self.blocked_until:
            return {"problem": "Groq's limit reached", "until": int(self.blocked_until * 1000)}
        if self.used(86400) + CHUNK_SEC > GROQ_PER_DAY:
            until = self.frees_at(86400, GROQ_PER_DAY, CHUNK_SEC)
            return {"problem": "Today's Groq allowance is used up", "until": until and int(until * 1000)}
        return None

    def wait_for(self, seconds: float) -> float | None:
        """How long to wait before sending `seconds` of audio, or None if Groq is out for now."""
        if self.disabled and time.time() >= self.recheck_at:
            self.disabled = None  # try the key again
        if self.disabled or time.time() < self.blocked_until:
            return None
        if self.used(86400) + seconds > GROQ_PER_DAY:
            return None
        if self.used(3600) + seconds <= GROQ_PER_HOUR:
            return 0
        # Wait until enough of the last hour's audio ages out.
        at = self.frees_at(3600, GROQ_PER_HOUR, seconds)
        return None if at is None else max(0, at - time.time())

    def record(self, seconds: float) -> None:
        self.sent.append((time.time(), max(10.0, seconds)))  # Groq bills at least 10 seconds
        while self.sent and time.time() - self.sent[0][0] > 86400:
            self.sent.popleft()
        self.save()


groq_allowance = GroqAllowance()


def transcribe(path: Path, start: float, length: float) -> tuple[list[list], str]:
    """Words as [seconds from the start of the episode, word] for one piece of the file, and
    which engine made them: Groq when it can, else Vosk."""
    if GROQ_KEY:
        words = groq_transcribe(path, start, length)
        if words is not None:
            return words, "groq"
    return vosk_transcribe(path, start, length), "vosk"


def groq_transcribe(path: Path, start: float, length: float) -> list[list] | None:
    """One piece through Groq's hosted Whisper. None means use Vosk for this piece."""
    wait = groq_allowance.wait_for(length)
    if wait is None or wait > GROQ_MAX_WAIT_SEC:
        return None
    if wait:
        log("waiting for Groq's hourly allowance", sec=round(wait))
        time.sleep(wait)
    mp3 = STATE / "groq-piece.mp3"
    # 16 kHz mono at 32 kbps: a 30-minute piece is about 7 MB, under the free tier's 25 MB limit.
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", str(path),
         "-ac", "1", "-ar", "16000", "-b:a", "32k", str(mp3)],
        check=True,
    )
    try:
        return groq_send(mp3, start, length)
    finally:
        mp3.unlink(missing_ok=True)


def groq_send(mp3: Path, start: float, length: float) -> list[list] | None:
    import httpx

    for attempt in range(3):
        try:
            with open(mp3, "rb") as f:
                res = httpx.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {GROQ_KEY}"},
                    files={"file": ("piece.mp3", f, "audio/mpeg")},
                    data={"model": GROQ_MODEL, "response_format": "verbose_json", "language": "en",
                          "timestamp_granularities[]": ["word"]},
                    timeout=300,
                )
        except (httpx.HTTPError, OSError) as e:
            log("Groq unreachable, retrying", error=str(e))
            time.sleep(backoff(attempt))
            continue
        if res.status_code == 200:
            data = res.json()
            groq_allowance.record(float(data.get("duration") or length))
            return [[round(start + w["start"], 2), w["word"].strip()] for w in data.get("words", []) if w["word"].strip()]
        if res.status_code == 429:
            retry = float(res.headers.get("retry-after") or 3600)
            groq_allowance.block(retry)
            log("Groq limit reached, using Vosk for now", retry_after_sec=round(retry))
            return None
        if res.status_code in (401, 403):
            groq_allowance.refuse(res.status_code)
            log("Groq refused the key; using Vosk, checking again in an hour", status=res.status_code)
            return None
        if res.status_code >= 500:
            time.sleep(backoff(attempt))
            continue
        log("Groq couldn't transcribe this piece, using Vosk", status=res.status_code, body=res.text[:200])
        return None
    return None


def vosk_transcribe(path: Path, start: float, length: float) -> list[list]:
    """One piece with Vosk on this machine: rougher, but always available."""
    from vosk import KaldiRecognizer

    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", str(path),
         "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE,
    )
    rec = KaldiRecognizer(vosk_model(), 16000)
    rec.SetWords(True)
    words: list[list] = []

    def take(result: str) -> None:
        for w in json.loads(result).get("result") or []:
            words.append([round(start + w["start"], 2), w["word"]])

    assert proc.stdout
    while chunk := proc.stdout.read(16000):
        if rec.AcceptWaveform(chunk):
            take(rec.Result())
    take(rec.FinalResult())
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg couldn't read the episode file")
    return words


def clock(sec: float) -> str:
    sec = max(0, int(sec))
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def transcript_lines(words: list[list]) -> str:
    """Eight words a line, each with when it starts and ends, so an ad's edges land within a few
    seconds and its end can be read off its last line instead of guessed from the next one."""
    lines = []
    for i in range(0, len(words), 8):
        end = words[i + 8][0] if i + 8 < len(words) else words[-1][0] + 1
        lines.append(f"[{clock(words[i][0])}-{clock(end)}] " + " ".join(w for _, w in words[i:i + 8]))
    return "\n".join(lines)


def find_ads(words: list[list]) -> list[dict]:
    if not words:
        return []
    prompt = (
        "Below is a machine transcript of part of a podcast episode, each line starting with the "
        "times it begins and ends. It has recognition errors, so read past misheard words. " + AD_RULES +
        " Give start as the first time of the ad's first line and end as the second time of the "
        "ad's last line, including any closing tagline or call to action, both as M:SS or H:MM:SS.\n\n"
        + transcript_lines(words)
    )
    return ask_gemini(prompt)


def clean(ads: list[dict], duration: float) -> list[dict]:
    """Drops impossible spans, cuts ones past the end, and joins copies from overlapping pieces."""
    kinds = {"inserted", "host_read", "promo"}
    spans = sorted(
        ({**a, "endSec": min(a["endSec"], duration), "kind": a["kind"] if a["kind"] in kinds else "inserted"} for a in ads),
        key=lambda a: a["startSec"],
    )
    out: list[dict] = []
    for a in spans:
        if a["endSec"] <= a["startSec"] or a["endSec"] - a["startSec"] > MAX_AD_SEC or a["startSec"] >= duration:
            continue
        if out and a["startSec"] < out[-1]["endSec"] - 3:
            out[-1]["endSec"] = max(out[-1]["endSec"], a["endSec"])
        else:
            out.append(dict(a))
    return out


# ---------- Scans ----------

def load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def save(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)


def process(job: dict) -> None:
    file_id = int(job["fileId"])
    audio = (CACHE / job["path"]).resolve()
    # Murmur only ever names files under its cache; anything else is not a job to run.
    if not audio.is_relative_to(CACHE.resolve()):
        raise ValueError("episode path is outside the cache folder")
    if not audio.exists():
        # Almost always the cache folder isn't mounted here, or not the same folder as Murmur's.
        log("episode file not found; is Murmur's cache folder mounted at /cache?", episode=job["title"], path=str(audio))
        set_status("error", f"Can't find episodes in {CACHE}. Mount Murmur's cache folder there, read-only.")
        murmur(f"/api/addon/ads/{file_id}", {"status": "failed", "error": "The episode file isn't in the cache folder."})
        return
    work = STATE / str(file_id)
    work.mkdir(parents=True, exist_ok=True)
    duration = duration_of(audio)
    pieces = max(1, math.ceil(duration / CHUNK_SEC))
    log("scanning", episode=job["title"], show=job["podcastTitle"], minutes=round(duration / 60), pieces=pieces)

    def words_of(i: int) -> list[list]:
        """A piece's transcript, from disk if an earlier run made it."""
        cached = load(work / f"words-{i}.json")
        if cached is not None:
            return cached
        started = time.monotonic()
        words, engine = transcribe(audio, i * CHUNK_SEC, CHUNK_SEC)
        save(work / f"words-{i}.json", words)
        log("piece transcribed", piece=i + 1, of=pieces, engine=engine, sec=round(time.monotonic() - started))
        heartbeat()
        return words

    found: list[dict] = []
    deferred: Paused | ConfigError | None = None
    for i in range(pieces):
        words = words_of(i)
        if i + 1 < pieces:
            # Run into the next piece, so an ad break on the cut is seen whole once.
            nxt = words_of(i + 1)
            words = words + [w for w in nxt if w[0] < (i + 1) * CHUNK_SEC + OVERLAP_SEC]
        ads = load(work / f"ads-{i}.json")
        if ads is None and deferred is None:
            try:
                ads = find_ads(words)
                save(work / f"ads-{i}.json", ads)
                set_status("ok", None)
            except Paused as e:
                budget.pause(e.seconds, e.reason)
                set_status("paused", f"{e.reason}. Resumes in about {round(e.seconds / 60)} minutes.")
                deferred = e
            except ConfigError as e:
                budget.pause(3600, str(e))
                set_status("error", str(e))
                deferred = e
        if ads is not None and deferred is None:
            found += ads
            done = i + 1 == pieces
            murmur(f"/api/addon/ads/{file_id}", {
                "status": "done" if done else "progress", "piecesDone": i + 1, "ads": clean(found, duration),
            })
    if deferred is not None:
        # Every piece is transcribed by now, so this episode only needs Gemini when it comes back.
        retry = deferred.seconds if isinstance(deferred, Paused) else 3600
        murmur(f"/api/addon/ads/{file_id}", {"status": "deferred", "retryAfterSec": retry, "reason": str(deferred)[:500]})
        return
    shutil.rmtree(work, ignore_errors=True)
    log("scan done", episode=job["title"], ads=len(clean(found, duration)))


def prune_state() -> None:
    """Drops leftovers from scans that never finished, after a week."""
    cutoff = time.time() - 7 * 86400
    for d in STATE.iterdir():
        # Only the add-on's own work folders, named by file id: /state mounted at the wrong
        # folder must never cost someone anything else that happens to be old.
        if d.is_dir() and d.name.isdigit() and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)


def main() -> None:
    if not SECRET:
        sys.exit("Set ADDON_SECRET to the same value as Murmur's.")
    STATE.mkdir(parents=True, exist_ok=True)
    prune_state()
    log("adscan started", version=VERSION, murmur=MURMUR_URL, model=GEMINI_MODEL,
        transcription="groq, vosk fallback" if GROQ_KEY else "vosk")
    if not GEMINI_KEY:
        set_status("error", "GEMINI_API_KEY isn't set.")
    # Before asking for work, so an interrupted scan comes straight back to this run.
    heartbeat(force=True)
    while True:
        heartbeat()
        if not GEMINI_KEY:
            time.sleep(IDLE_SEC)
            continue
        job = murmur("/api/addon/ads/next").get("job")
        if not job:
            if status["state"] == "paused" and time.time() >= budget.paused_until:
                set_status("ok", None)
            time.sleep(IDLE_SEC)
            continue
        try:
            process(job)
        except ScanGone:
            shutil.rmtree(STATE / str(job["fileId"]), ignore_errors=True)
        except Exception as e:  # one bad episode must never stop the add-on
            log("scan failed", episode=job.get("title"), error=str(e))
            try:
                murmur(f"/api/addon/ads/{job['fileId']}", {"status": "failed", "error": str(e)[:500]})
            except ScanGone:
                pass


if __name__ == "__main__":
    main()
