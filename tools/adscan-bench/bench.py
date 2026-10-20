"""Ad detection benchmark for Murmur's planned add-on.

Downloads one podcast episode, then:
  1. transcribes the first CLIP_MINUTES with each transcription engine, timing each and
     measuring the local ones' peak memory: Groq's hosted Whisper large-v3-turbo, Parakeet TDT
     0.6B (local, sherpa-onnx), and the older Whisper tiny, Whisper base and Vosk small;
  2. looks for ads in each transcript with keyword rules;
  3. if GEMINI_API_KEY is set, asks Gemini for the ads: from a transcript as text (gemini-text,
     in pieces; gemini-text-whole, in one go) and from the whole episode's audio (gemini).
Prints a report to the log and writes it, with every transcript, to /out.

Settings (environment variables):
  EPISODE_URL     audio URL of an episode (or EPISODE_FILE, a path to a mounted file)
  CLIP_MINUTES    how much of the episode is transcribed (default 10)
  ENGINES         comma list of groq, parakeet, whisper-tiny, whisper-base, vosk, gemini-text,
                  gemini-text-whole, gemini (default groq,parakeet,gemini-text)
  TEXT_FROM       the transcript gemini-text reads (default: the first engine in ENGINES that
                  produced one)
  GROQ_API_KEY    enables the groq engine
  GROQ_MODEL      default whisper-large-v3-turbo
  CHUNK_MINUTES   gemini-text sends the transcript in pieces this long (default 30), each
                  running CHUNK_OVERLAP_MINUTES (default 2) into the next; gemini-text-whole
                  sends it in one piece
  THREADS         CPU threads for the local engines (default: every core)
  GEMINI_API_KEY  enables the Gemini runs
  GEMINI_MODEL    default gemini-flash-lite-latest, which follows Google's newest Flash-Lite
  GEMINI_PRICE_IN / GEMINI_PRICE_OUT   USD per million tokens, for the cost line
                  (defaults 0.30 in and 2.50 out, Gemini 3.5 Flash-Lite)
"""

import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(os.environ.get("OUT_DIR", "/out"))
WORK = Path("/work")
CLIP_MINUTES = float(os.environ.get("CLIP_MINUTES", "10"))
THREADS = int(os.environ.get("THREADS") or os.cpu_count() or 4)
ENGINES = [e.strip() for e in os.environ.get("ENGINES", "groq,parakeet,gemini-text").split(",") if e.strip()]
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3-turbo")
# Uploads stay well under the free tier's 25 MB file limit.
GROQ_PIECE_SEC = 600
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
PRICE_IN = float(os.environ.get("GEMINI_PRICE_IN", "0.30"))
PRICE_OUT = float(os.environ.get("GEMINI_PRICE_OUT", "2.50"))
CHUNK_MINUTES = float(os.environ.get("CHUNK_MINUTES", "30"))
CHUNK_OVERLAP = float(os.environ.get("CHUNK_OVERLAP_MINUTES", "2"))

# Phrases that turn up in ad reads, including the sports-betting small print.
AD_PHRASES = [
    "brought to you by", "sponsored by", "our sponsor", "today's sponsor", "this episode is",
    "promo code", "use code", "offer code", "with code", "dot com slash", "slash podcast",
    "free trial", "first month", "percent off", "sign up at", "download the app", "visit ",
    "terms apply", "terms and conditions", "must be twenty one", "must be 21", "gambling problem",
    "eight hundred gambler", "1-800-gambler", "first bet", "bonus bets", "deposit match",
]


def log(*parts: object) -> None:
    print(*parts, flush=True)


def clock(sec: float) -> str:
    sec = max(0, int(sec))
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def parse_clock(value: str) -> float:
    """'12:34', '1:02:03' or '754.5' as seconds."""
    value = value.strip()
    if ":" not in value:
        return float(value)
    total = 0.0
    for part in value.split(":"):
        total = total * 60 + float(part)
    return total


def cpu_info() -> dict:
    info = {"model": "unknown", "cores": os.cpu_count(), "avx": False, "avx2": False, "ram_mb": None}
    try:
        text = Path("/proc/cpuinfo").read_text()
        m = re.search(r"model name\s*:\s*(.+)", text)
        if m:
            info["model"] = m.group(1).strip()
        flags = re.search(r"flags\s*:\s*(.+)", text)
        if flags:
            names = set(flags.group(1).split())
            info["avx"], info["avx2"] = "avx" in names, "avx2" in names
        mem = re.search(r"MemTotal:\s*(\d+)", Path("/proc/meminfo").read_text())
        if mem:
            info["ram_mb"] = int(mem.group(1)) // 1024
    except OSError:
        pass
    return info


def fetch_episode() -> Path:
    file = os.environ.get("EPISODE_FILE")
    if file:
        return Path(file)
    url = os.environ.get("EPISODE_URL")
    if not url:
        sys.exit("Set EPISODE_URL (an episode's audio URL) or EPISODE_FILE.")
    ext = ".m4a" if re.search(r"\.(m4a|mp4|aac)(\?|$)", url) else ".mp3"
    dest = WORK / f"episode{ext}"
    log(f"Downloading the episode...")
    req = urllib.request.Request(url, headers={"User-Agent": "Murmur-adscan-bench/1.0"})
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=120) as res, open(dest, "wb") as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)
    log(f"  {dest.stat().st_size / 1e6:.1f} MB in {time.monotonic() - started:.0f}s")
    return dest


def duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def run_measured(cmd: list[str]) -> dict:
    """Runs a command under GNU time: wall seconds, peak memory, and how it ended."""
    started = time.monotonic()
    res = subprocess.run(["/usr/bin/time", "-v", *cmd], capture_output=True, text=True)
    wall = time.monotonic() - started
    rss = re.search(r"Maximum resident set size \(kbytes\): (\d+)", res.stderr)
    signal = re.search(r"Command terminated by signal (\d+)", res.stderr)
    error = None
    if signal and signal.group(1) == "4":
        error = "illegal instruction: this build needs a CPU feature (likely AVX) this machine lacks"
    elif res.returncode != 0:
        error = (res.stderr.strip().splitlines() or ["failed"])[-1][:300]
    return {"wall": wall, "rss_mb": int(rss.group(1)) / 1024 if rss else None, "error": error}


def whisper(model: str, wav: Path) -> tuple[dict, list[dict]]:
    stem = OUT / f"whisper-{model}"
    run = run_measured([
        "whisper-cli", "-m", f"/models/ggml-{model}.en.bin", "-f", str(wav),
        "-l", "en", "-t", str(THREADS), "-np", "-oj", "-of", str(stem),
    ])
    segments = []
    if not run["error"]:
        data = json.loads(Path(f"{stem}.json").read_text())
        for s in data.get("transcription", []):
            segments.append({"start": s["offsets"]["from"] / 1000, "end": s["offsets"]["to"] / 1000, "text": s["text"].strip()})
    return run, segments


def vosk(wav: Path) -> tuple[dict, list[dict]]:
    out = OUT / "vosk.json"
    run = run_measured(["python", "/app/vosk_run.py", "/models/vosk-model-small-en-us-0.15", str(wav), str(out)])
    segments = [] if run["error"] else json.loads(out.read_text())
    return run, segments


def parakeet(wav: Path) -> tuple[dict, list[dict]]:
    out = OUT / "parakeet.json"
    run = run_measured([
        "python", "/app/parakeet_run.py", "/models/parakeet", "/models/silero_vad.onnx", str(wav), str(out), str(THREADS),
    ])
    segments = [] if run["error"] else json.loads(out.read_text())
    return run, segments


def groq(wav: Path, clip_sec: float) -> tuple[dict, list[dict]]:
    """Groq's hosted Whisper, in 10-minute uploads with word times."""
    import httpx

    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return {"wall": 0, "rss_mb": None, "error": "set GROQ_API_KEY to include it"}, []
    started = time.monotonic()
    segments: list[dict] = []
    try:
        for i in range(math.ceil(clip_sec / GROQ_PIECE_SEC)):
            offset = i * GROQ_PIECE_SEC
            mp3 = WORK / f"groq-{i}.mp3"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-ss", str(offset), "-t", str(GROQ_PIECE_SEC), "-i", str(wav),
                 "-ac", "1", "-ar", "16000", "-b:a", "32k", str(mp3)],
                check=True,
            )
            with open(mp3, "rb") as f:
                res = httpx.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (mp3.name, f, "audio/mpeg")},
                    data={"model": GROQ_MODEL, "response_format": "verbose_json", "language": "en",
                          "timestamp_granularities[]": ["word", "segment"]},
                    timeout=300,
                )
            if res.status_code != 200:
                raise RuntimeError(f"Groq answered {res.status_code}: {res.text[:200]}")
            data = res.json()
            words = [[round(offset + w["start"], 2), w["word"].strip()] for w in data.get("words", [])]
            for s in data.get("segments", []):
                start, end = offset + s["start"], offset + s["end"]
                segments.append({"start": start, "end": end, "text": s["text"].strip(),
                                 "words": [w for w in words if start <= w[0] < end]})
    except Exception as e:  # report it; the other engines still run
        return {"wall": time.monotonic() - started, "rss_mb": None, "error": str(e)[:300]}, segments
    (OUT / "groq.json").write_text(json.dumps(segments))
    return {"wall": time.monotonic() - started, "rss_mb": None, "error": None}, segments


def keyword_ads(segments: list[dict]) -> list[dict]:
    """Spans of transcript with ad phrases, joining hits less than 45s apart."""
    spans: list[dict] = []
    for s in segments:
        text = s["text"].lower()
        hits = [p.strip() for p in AD_PHRASES if p in text]
        if not hits:
            continue
        if spans and s["start"] - spans[-1]["end"] < 45:
            spans[-1]["end"] = s["end"]
            spans[-1]["hits"].update(hits)
        else:
            spans.append({"start": s["start"], "end": s["end"], "hits": set(hits)})
    return spans


def save_transcript(name: str, segments: list[dict]) -> None:
    lines = [f"[{clock(s['start'])}] {s['text']}" for s in segments]
    (OUT / f"{name}.txt").write_text("\n".join(lines) + "\n")


AD_RULES = (
    "List every advertisement in it: ads inserted by the host platform, sponsor reads by the "
    "hosts, and promos for other podcasts or products. Leave out the show's own intro and outro "
    "and requests to rate or subscribe. kind is one of inserted, host_read or promo. advertiser "
    "is the brand, or empty if none is named. first_words is the first few words of the ad."
)


def gemini_ask(client, contents: list, name: str) -> dict:
    """Asks Gemini for the ads; writes /out/<name>.json and returns the ads, tokens and cost."""
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

    log(f"  asking {GEMINI_MODEL}...")
    for attempt in range(4):
        try:
            res = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Ads, temperature=0),
            )
            break
        except errors.APIError as e:
            # Rate limited or briefly unavailable: wait and try again, longer each time.
            if e.code not in (429, 500, 503) or attempt == 3:
                raise
            wait = 15 * 2 ** attempt
            log(f"  {e.code}, retrying in {wait}s")
            time.sleep(wait)
    usage = res.usage_metadata
    tokens_in = usage.prompt_token_count or 0
    tokens_out = (usage.candidates_token_count or 0) + (getattr(usage, "thoughts_token_count", 0) or 0)
    ads = [
        {"start": parse_clock(a.start), "end": parse_clock(a.end), "kind": a.kind, "advertiser": a.advertiser, "first_words": a.first_words}
        for a in Ads.model_validate_json(res.text).ads
    ]
    (OUT / f"{name}.json").write_text(json.dumps({"model": GEMINI_MODEL, "ads": ads, "tokens_in": tokens_in, "tokens_out": tokens_out}, indent=2))
    return {
        "tokens_in": tokens_in, "tokens_out": tokens_out,
        "cost": tokens_in / 1e6 * PRICE_IN + tokens_out / 1e6 * PRICE_OUT, "ads": ads,
    }


def gemini_client():
    from google import genai

    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def gemini_audio(episode: Path) -> dict:
    client = gemini_client()
    started = time.monotonic()
    log("  uploading...")
    file = client.files.upload(file=str(episode))
    while file.state and file.state.name == "PROCESSING":
        time.sleep(2)
        file = client.files.get(name=file.name)
    upload = time.monotonic() - started
    prompt = (
        "This is a podcast episode. " + AD_RULES + " Give start and end as MM:SS (or H:MM:SS) "
        "from the start of the audio, as exactly as you can: start at the first word of the ad, "
        "end after its last word."
    )
    result = gemini_ask(client, [file, prompt], "gemini")
    try:
        client.files.delete(name=file.name)
    except Exception:
        pass
    return {**result, "upload": upload, "total": time.monotonic() - started}


def timed_lines(segments: list[dict]) -> list[tuple[float, str]]:
    """The transcript as short timed lines (10 words each where word times are known), so an
    ad's edges can be placed within a few seconds."""
    lines = []
    for s in segments:
        words = s.get("words")
        if not words:
            lines.append((s["start"], s["text"]))
            continue
        for i in range(0, len(words), 10):
            chunk = words[i:i + 10]
            lines.append((chunk[0][0], " ".join(w for _, w in chunk)))
    return lines


def merge_ads(ads: list[dict]) -> list[dict]:
    """Joins the copies of an ad that two overlapping chunks both found. Ads that only touch
    (one ends where the next starts) stay apart."""
    merged: list[dict] = []
    for ad in sorted(ads, key=lambda a: a["start"]):
        if merged and ad["start"] < merged[-1]["end"] - 3:
            merged[-1]["end"] = max(merged[-1]["end"], ad["end"])
        else:
            merged.append(dict(ad))
    return merged


def gemini_text(segments: list[dict], chunk_minutes: float, name: str) -> dict:
    """Asks about the transcript in pieces of chunk_minutes (0 for one piece), each running
    CHUNK_OVERLAP_MINUTES into the next so an ad break on a cut is seen whole once."""
    lines = timed_lines(segments)
    (OUT / "gemini-text-input.txt").write_text("".join(f"[{clock(t)}] {text}\n" for t, text in lines))
    end = lines[-1][0] + 1 if lines else 0
    step = chunk_minutes * 60 or end
    client = gemini_client()
    started = time.monotonic()
    ads: list[dict] = []
    tokens_in = tokens_out = 0
    cost = 0.0
    chunks = 0
    at = 0.0
    while at < end:
        piece = [f"[{clock(t)}] {text}" for t, text in lines if at <= t < at + step + CHUNK_OVERLAP * 60]
        at += step
        if not piece:
            continue
        chunks += 1
        prompt = (
            "Below is a machine transcript of part of a podcast episode, each line starting with the "
            "time it begins. It has recognition errors, so read past misheard words. " + AD_RULES +
            " Give start as the time of the line where the ad begins and end as the time of the first "
            "line after it ends, both as M:SS or H:MM:SS. If an ad runs past the last line, end it "
            "at the last line.\n\n" + "\n".join(piece)
        )
        result = gemini_ask(client, [prompt], f"{name}-{chunks}")
        ads += result["ads"]
        tokens_in += result["tokens_in"]
        tokens_out += result["tokens_out"]
        cost += result["cost"]
    return {
        "ads": merge_ads(ads), "tokens_in": tokens_in, "tokens_out": tokens_out, "cost": cost,
        "chunks": chunks, "upload": 0.0, "total": time.monotonic() - started,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    report: list[str] = ["# Ad detection benchmark", ""]

    def say(line: str = "") -> None:
        log(line)
        report.append(line)

    cpu = cpu_info()
    say(f"CPU: {cpu['model']}, {cpu['cores']} cores, AVX {'yes' if cpu['avx'] else 'no'}, AVX2 {'yes' if cpu['avx2'] else 'no'}")
    say(f"RAM: {cpu['ram_mb']} MB. Local engines use {THREADS} threads.")

    episode = fetch_episode()
    full = duration_of(episode)
    clip_sec = min(full, CLIP_MINUTES * 60)
    wav = WORK / "clip.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(episode), "-t", str(clip_sec), "-ac", "1", "-ar", "16000", str(wav)],
        check=True,
    )
    say(f"Episode: {clock(full)} long. Transcribing the first {clock(clip_sec)}.")
    say()

    local = [e for e in ENGINES if not e.startswith("gemini")]
    results = {}
    for engine in local:
        log(f"Running {engine}...")
        if engine.startswith("whisper-"):
            run, segments = whisper(engine.removeprefix("whisper-"), wav)
        elif engine == "vosk":
            run, segments = vosk(wav)
        elif engine == "parakeet":
            run, segments = parakeet(wav)
        elif engine == "groq":
            run, segments = groq(wav, clip_sec)
        else:
            log(f"  unknown engine {engine}, skipped")
            continue
        results[engine] = (run, segments)
        if segments:
            save_transcript(engine, segments)
        log(f"  {'failed: ' + run['error'] if run['error'] else f'done in {run['wall']:.0f}s'}")

    say("## Speed and memory")
    say()
    say("| Engine | Time | Speed | Peak memory | Words |")
    say("| --- | --- | --- | --- | --- |")
    for engine, (run, segments) in results.items():
        if run["error"]:
            say(f"| {engine} | failed | {run['error']} | | |")
            continue
        speed = clip_sec / run["wall"] if run["wall"] else 0
        words = sum(len(s["text"].split()) for s in segments)
        memory = f"{run['rss_mb']:.0f} MB" if run["rss_mb"] is not None else "none here (cloud)"
        say(f"| {engine} | {run['wall']:.0f}s | {speed:.1f}x real time | {memory} | {words} |")
    say()
    say("Speed above 1x keeps up with listening. A 1-hour episode takes about 60 / speed minutes.")
    say()

    say(f"## Ads found by keyword rules (first {clock(clip_sec)})")
    say()
    for engine, (run, segments) in results.items():
        spans = keyword_ads(segments)
        say(f"**{engine}:** " + ("none" if not spans else ""))
        for s in spans:
            say(f"- {clock(s['start'])} to {clock(s['end'])}: {', '.join(sorted(s['hits']))}")
        say()

    source = os.environ.get("TEXT_FROM") or next((e for e, (_, segs) in results.items() if segs), "")
    text_segments = results.get(source, (None, []))[1]
    transcript = f"{source or 'no'} transcript of the first {clock(clip_sec)}"
    for engine, what in (
        ("gemini", "whole episode audio"),
        ("gemini-text", f"{transcript}, in {CHUNK_MINUTES:g} minute pieces"),
        ("gemini-text-whole", f"{transcript}, in one piece"),
    ):
        if engine not in ENGINES:
            continue
        say(f"## {engine} ({GEMINI_MODEL}, {what})")
        say()
        if not os.environ.get("GEMINI_API_KEY"):
            say("Skipped: set GEMINI_API_KEY to include it.")
        elif engine != "gemini" and not text_segments:
            say("Skipped: needs a transcript, so add a transcription engine to ENGINES.")
        else:
            log(f"Running {engine}...")
            try:
                if engine == "gemini":
                    g = gemini_audio(episode)
                else:
                    g = gemini_text(text_segments, CHUNK_MINUTES if engine == "gemini-text" else 0, engine)
                upload = f" (upload {g['upload']:.0f}s)" if g["upload"] else ""
                pieces = f" in {g['chunks']} requests" if g.get("chunks", 1) > 1 else ""
                say(f"Took {g['total']:.0f}s{upload}{pieces}. Tokens: {g['tokens_in']:,} in, {g['tokens_out']:,} out. "
                    f"Cost about ${g['cost']:.4f} at ${PRICE_IN} / ${PRICE_OUT} per million.")
                say()
                for a in g["ads"]:
                    mark = " (after the local clip)" if engine == "gemini" and a["start"] >= clip_sec else ""
                    who = f" {a['advertiser']}" if a["advertiser"] else ""
                    say(f"- {clock(a['start'])} to {clock(a['end'])}: {a['kind']}{who}, \"{a['first_words']}\"{mark}")
                if not g["ads"]:
                    say("No ads found.")
            except Exception as e:  # report and carry on; the other results still stand
                say(f"Failed: {e}")
        say()

    say("Check a few of these times in a player to see which are right. Transcripts are in /out.")
    (OUT / "report.md").write_text("\n".join(report) + "\n")


if __name__ == "__main__":
    main()
