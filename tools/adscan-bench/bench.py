"""Ad detection benchmark for Murmur's planned add-on.

Downloads one podcast episode, then:
  1. transcribes the first CLIP_MINUTES with each local engine (Whisper tiny, Whisper base,
     Vosk small), timing each and measuring its peak memory;
  2. looks for ads in each transcript with keyword rules;
  3. if GEMINI_API_KEY is set, sends the whole episode to Gemini and asks it for the ads.
Prints a report to the log and writes it, with every transcript, to /out.

Settings (environment variables):
  EPISODE_URL     audio URL of an episode (or EPISODE_FILE, a path to a mounted file)
  CLIP_MINUTES    how much of the episode the local engines transcribe (default 10)
  ENGINES         comma list of whisper-tiny, whisper-base, vosk, gemini (default all)
  THREADS         CPU threads for the local engines (default: every core)
  GEMINI_API_KEY  enables the Gemini run
  GEMINI_MODEL    default gemini-2.5-flash-lite
  GEMINI_PRICE_IN / GEMINI_PRICE_OUT   USD per million tokens, for the cost line
                  (defaults 0.30 audio in and 0.40 out, Gemini 2.5 Flash-Lite)
"""

import json
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
ENGINES = [e.strip() for e in os.environ.get("ENGINES", "whisper-tiny,whisper-base,vosk,gemini").split(",") if e.strip()]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
PRICE_IN = float(os.environ.get("GEMINI_PRICE_IN", "0.30"))
PRICE_OUT = float(os.environ.get("GEMINI_PRICE_OUT", "0.40"))

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


def gemini(episode: Path) -> dict:
    from google import genai
    from google.genai import types
    from pydantic import BaseModel

    class Ad(BaseModel):
        start: str
        end: str
        kind: str
        advertiser: str
        first_words: str

    class Ads(BaseModel):
        ads: list[Ad]

    prompt = (
        "This is a podcast episode. List every advertisement in it: ads inserted by the host "
        "platform, sponsor reads by the hosts, and promos for other podcasts or products. Leave "
        "out the show's own intro and outro and requests to rate or subscribe. For each ad give "
        "start and end as MM:SS (or H:MM:SS) from the start of the audio, as exactly as you can: "
        "start at the first word of the ad, end after its last word. kind is one of inserted, "
        "host_read or promo. advertiser is the brand, or empty if none is named. first_words is "
        "the first few words of the ad."
    )
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    started = time.monotonic()
    log("  uploading...")
    file = client.files.upload(file=str(episode))
    while file.state and file.state.name == "PROCESSING":
        time.sleep(2)
        file = client.files.get(name=file.name)
    upload = time.monotonic() - started
    log(f"  asking {GEMINI_MODEL}...")
    res = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[file, prompt],
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Ads, temperature=0),
    )
    total = time.monotonic() - started
    try:
        client.files.delete(name=file.name)
    except Exception:
        pass
    usage = res.usage_metadata
    tokens_in = usage.prompt_token_count or 0
    tokens_out = (usage.candidates_token_count or 0) + (getattr(usage, "thoughts_token_count", 0) or 0)
    ads = [
        {"start": parse_clock(a.start), "end": parse_clock(a.end), "kind": a.kind, "advertiser": a.advertiser, "first_words": a.first_words}
        for a in Ads.model_validate_json(res.text).ads
    ]
    (OUT / "gemini.json").write_text(json.dumps({"model": GEMINI_MODEL, "ads": ads, "tokens_in": tokens_in, "tokens_out": tokens_out}, indent=2))
    return {
        "upload": upload, "total": total, "tokens_in": tokens_in, "tokens_out": tokens_out,
        "cost": tokens_in / 1e6 * PRICE_IN + tokens_out / 1e6 * PRICE_OUT, "ads": ads,
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
    say(f"Episode: {clock(full)} long. Local engines transcribe the first {clock(clip_sec)}.")
    say()

    local = [e for e in ENGINES if e != "gemini"]
    results = {}
    for engine in local:
        log(f"Running {engine}...")
        if engine.startswith("whisper-"):
            run, segments = whisper(engine.removeprefix("whisper-"), wav)
        elif engine == "vosk":
            run, segments = vosk(wav)
        else:
            log(f"  unknown engine {engine}, skipped")
            continue
        results[engine] = (run, segments)
        if segments:
            save_transcript(engine, segments)
        log(f"  {'failed: ' + run['error'] if run['error'] else f'done in {run['wall']:.0f}s'}")

    say("## Speed and memory (local)")
    say()
    say("| Engine | Time | Speed | Peak memory | Words |")
    say("| --- | --- | --- | --- | --- |")
    for engine, (run, segments) in results.items():
        if run["error"]:
            say(f"| {engine} | failed | {run['error']} | | |")
            continue
        speed = clip_sec / run["wall"] if run["wall"] else 0
        words = sum(len(s["text"].split()) for s in segments)
        say(f"| {engine} | {run['wall']:.0f}s | {speed:.1f}x real time | {run['rss_mb']:.0f} MB | {words} |")
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

    if "gemini" in ENGINES:
        say(f"## Gemini ({GEMINI_MODEL}, whole episode)")
        say()
        if not os.environ.get("GEMINI_API_KEY"):
            say("Skipped: set GEMINI_API_KEY to include it.")
        else:
            log("Running gemini...")
            try:
                g = gemini(episode)
                say(f"Took {g['total']:.0f}s (upload {g['upload']:.0f}s). Tokens: {g['tokens_in']:,} in, {g['tokens_out']:,} out. "
                    f"Cost about ${g['cost']:.3f} at ${PRICE_IN} / ${PRICE_OUT} per million.")
                say()
                for a in g["ads"]:
                    mark = "" if a["start"] < clip_sec else " (after the local clip)"
                    who = f" {a['advertiser']}" if a["advertiser"] else ""
                    say(f"- {clock(a['start'])} to {clock(a['end'])}: {a['kind']}{who}, \"{a['first_words']}\"{mark}")
                if not g["ads"]:
                    say("No ads found.")
            except Exception as e:  # report and carry on; the local results still stand
                say(f"Failed: {e}")
        say()

    say("Check a few of these times in a player to see which are right. Transcripts are in /out.")
    (OUT / "report.md").write_text("\n".join(report) + "\n")


if __name__ == "__main__":
    main()
