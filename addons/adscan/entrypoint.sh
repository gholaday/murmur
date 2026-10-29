#!/bin/sh
# Runs the add-on as PUID:PGID, so its files under /state are owned by your user and nothing it
# does (ffmpeg and Vosk on untrusted audio) runs as root.
set -e

mkdir -p "$STATE_DIR"

if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c %u "$STATE_DIR")" != "$PUID" ] || [ "$(stat -c %g "$STATE_DIR")" != "$PGID" ]; then
    chown -R "$PUID:$PGID" "$STATE_DIR"
  fi
  exec gosu "$PUID:$PGID" "$@"
fi

exec "$@"
