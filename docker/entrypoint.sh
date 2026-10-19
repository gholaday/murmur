#!/bin/sh
# Runs Murmur as PUID:PGID so files in /data are owned by your NAS user, not root.
set -e

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c %u "$DATA_DIR")" != "$PUID" ] || [ "$(stat -c %g "$DATA_DIR")" != "$PGID" ]; then
    echo "Setting owner of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
