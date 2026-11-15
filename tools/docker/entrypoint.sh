#!/bin/sh
# Spec: knowledge/operations/docker-and-render.md
# Render mounts /var/data as root:1000, so a plain USER app cannot write the
# SQLite files. Root fixes ownership once per boot, then setpriv drops to 1993.
set -eu

if [ "$(id -u)" = "0" ]; then
  if [ -d /var/data ]; then
    chown -R 1993:1993 /var/data
  fi
  if [ -d /app/data ]; then
    chown -R 1993:1993 /app/data
  fi
  export HOME=/home/app USER=app LOGNAME=app
  exec setpriv --reuid=1993 --regid=1993 --init-groups "$@"
fi

export HOME=/home/app
exec "$@"
