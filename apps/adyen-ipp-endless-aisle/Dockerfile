FROM denoland/deno:2.9.4

WORKDIR /app
ENV PORT=8000
ENV DATABASE_PATH=/app/data/ipp.sqlite

COPY deno.json deno.lock ./
COPY packages ./packages
COPY tools/dev ./tools/dev
COPY tools/build ./tools/build
COPY tools/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY apps ./apps

RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && install -d -o 1993 -g 1993 /app/data /home/deno
RUN deno task build:ipp
RUN deno run -A tools/build/assert-built-ssr.ts apps/adyen-ipp-endless-aisle "Endless Aisle"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD deno eval "const p=Deno.env.get('PORT')??'8000';const r=await fetch('http://127.0.0.1:'+p+'/healthz');if(!r.ok)Deno.exit(1)"

# Render mounts /var/data as root:1000, so a plain USER deno cannot open the
# SQLite files. The entrypoint starts as root only to chown the mount and
# /app/data to uid 1993, then drops privileges before the app starts. The SAST
# missing-user rules are waived because the runtime process is not root.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["deno", "task", "--cwd", "apps/adyen-ipp-endless-aisle", "start"]
