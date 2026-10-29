#!/bin/sh
# Runs the add-on as PUID:PGID so stream and download files in /cache are owned by your user.
set -e

mkdir -p "$CACHE_DIR"

if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c %u "$CACHE_DIR")" != "$PUID" ] || [ "$(stat -c %g "$CACHE_DIR")" != "$PGID" ]; then
    chown -R "$PUID:$PGID" "$CACHE_DIR"
  fi
  # A GPU passed in as /dev/dri belongs to a group on the host; join it so ffmpeg can use it.
  groups="$PGID"
  for node in /dev/dri/*; do
    [ -e "$node" ] && groups="$groups:$(stat -c %g "$node")"
  done
  exec su-exec "$PUID:$groups" "$@"
fi

exec "$@"
