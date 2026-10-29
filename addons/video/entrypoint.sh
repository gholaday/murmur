#!/bin/sh
# Runs the add-on as PUID:PGID so stream and download files in /cache are owned by your user.
set -e

mkdir -p "$CACHE_DIR"

if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c %u "$CACHE_DIR")" != "$PUID" ] || [ "$(stat -c %g "$CACHE_DIR")" != "$PGID" ]; then
    chown -R "$PUID:$PGID" "$CACHE_DIR"
  fi
  # A GPU passed in as /dev/dri belongs to a group on the host; join it so ffmpeg can use it.
  # su-exec sets just one group from the command line, but a named user also gets the groups
  # /etc/group lists them in, so the user gets a name and joins each GPU node's group there.
  grep -q "^murmur:" /etc/passwd || echo "murmur:x:$PUID:$PGID::/app:/sbin/nologin" >> /etc/passwd
  for node in /dev/dri/*; do
    [ -e "$node" ] || continue
    gid=$(stat -c %g "$node")
    group=$(awk -F: -v id="$gid" '$3 == id { print $1; exit }' /etc/group)
    if [ -z "$group" ]; then
      group="gpu$gid"
      addgroup -g "$gid" "$group"
    fi
    addgroup murmur "$group" 2> /dev/null || true
  done
  exec su-exec murmur "$@"
fi

exec "$@"
