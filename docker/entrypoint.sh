#!/bin/sh
# Runs Murmur as PUID:PGID so files in /data are owned by your user on the host, not root.
set -e

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  for dir in "$DATA_DIR" "$EPISODE_CACHE_DIR"; do
    [ -d "$dir" ] || continue
    if [ "$(stat -c %u "$dir")" != "$PUID" ] || [ "$(stat -c %g "$dir")" != "$PGID" ]; then
      echo "Setting owner of $dir to $PUID:$PGID"
      chown -R "$PUID:$PGID" "$dir"
    fi
  done
  # A GPU passed in as /dev/dri belongs to a group on the host; join it so ffmpeg can use it.
  groups="$PGID"
  for node in /dev/dri/*; do
    [ -e "$node" ] && groups="$groups:$(stat -c %g "$node")"
  done
  exec su-exec "$PUID:$groups" "$@"
fi

exec "$@"
