"""Transcribes a 16 kHz mono WAV with Vosk. Run as its own process so its time and memory
are measured on their own. Usage: vosk_run.py <model dir> <wav> <out.json>"""

import json
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
model_dir, wav_path, out_path = sys.argv[1:4]
model = Model(model_dir)
segments = []

with wave.open(wav_path, "rb") as wf:
    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(True)

    def take(result: str) -> None:
        words = json.loads(result).get("result") or []
        if words:
            segments.append(
                {
                    "start": words[0]["start"],
                    "end": words[-1]["end"],
                    "text": " ".join(w["word"] for w in words),
                }
            )

    while True:
        data = wf.readframes(8000)
        if not data:
            break
        if rec.AcceptWaveform(data):
            take(rec.Result())
    take(rec.FinalResult())

with open(out_path, "w") as f:
    json.dump(segments, f)
