# Ad detection benchmark for Murmur's planned add-on. Run once on the NAS to see how fast
# each way of transcribing is there and how well each finds the ads. Not part of Murmur.

FROM debian:bookworm-slim AS whisper
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG WHISPER_VERSION=v1.7.5
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# A generic x86-64 build with SSE4.2. The AS5304T's Celeron J4105 has no AVX, and a build tuned to the
# machine that compiles it would stop there with "illegal instruction". Pass
# --build-arg WHISPER_AVX=ON to measure a CPU that has AVX2 at full speed.
ARG WHISPER_AVX=OFF
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
      -DGGML_NATIVE=OFF -DGGML_SSE42=ON -DGGML_BMI2=OFF -DGGML_AVX=${WHISPER_AVX} -DGGML_AVX2=${WHISPER_AVX} \
      -DGGML_FMA=${WHISPER_AVX} -DGGML_F16C=${WHISPER_AVX} -DGGML_AVX512=OFF \
  && cmake --build build -j --config Release --target whisper-cli

FROM python:3.12-slim-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg time \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir vosk==0.3.45 google-genai==1.21.1 sherpa-onnx==1.13.6 numpy==2.3.4
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
ADD https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin /models/ggml-tiny.en.bin
ADD https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin /models/ggml-base.en.bin
ADD https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip /tmp/vosk.zip
RUN python -m zipfile -e /tmp/vosk.zip /models && rm /tmp/vosk.zip
# NVIDIA Parakeet TDT 0.6B (English, int8) for sherpa-onnx, and Silero VAD to cut audio at pauses.
ADD https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2 /tmp/parakeet.tar.bz2
RUN python -c "import tarfile; tarfile.open('/tmp/parakeet.tar.bz2').extractall('/tmp/p')" \
  && mv /tmp/p/* /models/parakeet && rm -rf /tmp/p /tmp/parakeet.tar.bz2
ADD https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx /models/silero_vad.onnx
COPY bench.py vosk_run.py parakeet_run.py /app/
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/bench.py"]
