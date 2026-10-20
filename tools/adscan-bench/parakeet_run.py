"""Transcribes a 16 kHz mono WAV with NVIDIA Parakeet TDT 0.6B through sherpa-onnx. The model
takes up to about 20 seconds at a time, so Silero VAD cuts the audio at pauses first. Run as its
own process so its time and memory are measured on their own.
Usage: parakeet_run.py <model dir> <vad model> <wav> <out.json> <threads>"""

import glob
import json
import sys
import wave

import numpy as np
import sherpa_onnx

model_dir, vad_path, wav_path, out_path, threads = sys.argv[1:6]
RATE = 16000


def pick(name: str) -> str:
    return sorted(glob.glob(f"{model_dir}/{name}*.onnx"))[0]


recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=pick("encoder"),
    decoder=pick("decoder"),
    joiner=pick("joiner"),
    tokens=f"{model_dir}/tokens.txt",
    num_threads=int(threads),
    model_type="nemo_transducer",
)

with wave.open(wav_path) as wf:
    samples = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768

config = sherpa_onnx.VadModelConfig()
config.silero_vad.model = vad_path
config.silero_vad.min_silence_duration = 0.25
config.silero_vad.max_speech_duration = 20
config.sample_rate = RATE
vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=120)
window = config.silero_vad.window_size
segments = []


def decode_ready() -> None:
    while not vad.empty():
        seg = vad.front
        start = seg.start / RATE
        stream = recognizer.create_stream()
        stream.accept_waveform(RATE, seg.samples)
        recognizer.decode_stream(stream)
        result = stream.result
        # Tokens are word pieces; one starting with a space (or ▁) begins a new word.
        words: list[list] = []
        for token, t in zip(result.tokens, result.timestamps):
            if token.startswith((" ", "▁")) or not words:
                words.append([round(start + t, 2), token.strip().lstrip("▁")])
            else:
                words[-1][1] += token
        words = [w for w in words if w[1]]
        if words:
            segments.append({"start": start, "end": start + len(seg.samples) / RATE, "text": result.text.strip(), "words": words})
        vad.pop()


for i in range(0, len(samples), window):
    vad.accept_waveform(samples[i:i + window])
    decode_ready()
vad.flush()
decode_ready()

with open(out_path, "w") as f:
    json.dump(segments, f)
