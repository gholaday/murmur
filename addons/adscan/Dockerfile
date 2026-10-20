# Murmur's optional ad detection add-on. See README.md.
FROM python:3.12-slim-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir vosk==0.3.45 google-genai==1.21.1 tzdata==2025.2
ADD https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip /tmp/vosk.zip
RUN python -m zipfile -e /tmp/vosk.zip /models && rm /tmp/vosk.zip
COPY adscan.py /app/
ARG ADSCAN_VERSION=dev
ENV ADSCAN_VERSION=$ADSCAN_VERSION \
    PYTHONUNBUFFERED=1
VOLUME ["/state"]
CMD ["python", "/app/adscan.py"]
