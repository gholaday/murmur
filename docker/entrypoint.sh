#!/bin/sh
# Runs Murmur as PUID:PGID so files in /data are owned by your user on the host, not root.
set -e

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  # CACHE_DIR, or its old name EPISODE_CACHE_DIR, as env.ts reads them.
  for dir in "$DATA_DIR" "${CACHE_DIR:-${EPISODE_CACHE_DIR:-/cache}}"; do
    [ -d "$dir" ] || continue
    if [ "$(stat -c %u "$dir")" != "$PUID" ] || [ "$(stat -c %g "$dir")" != "$PGID" ]; then
      echo "Setting owner of $dir to $PUID:$PGID"
      chown -R "$PUID:$PGID" "$dir"
    fi
  done
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
