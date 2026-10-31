# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# Murmur's optional ad detection add-on. See README.md.
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg gosu \
  && rm -rf /var/lib/apt/lists/*
# Every package, down to the dependencies' dependencies, at a fixed version and hash; see requirements.in.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt && rm /tmp/requirements.txt
ADD --checksum=sha256:30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498 \
  https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip /tmp/vosk.zip
RUN python -m zipfile -e /tmp/vosk.zip /models && rm /tmp/vosk.zip
COPY adscan.py /app/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ARG ADSCAN_VERSION=dev
ENV ADSCAN_VERSION=$ADSCAN_VERSION \
    PYTHONUNBUFFERED=1 \
    STATE_DIR=/state \
    PUID=1000 \
    PGID=1000
VOLUME ["/state"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "/app/adscan.py"]
