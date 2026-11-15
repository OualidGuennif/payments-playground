# Spec: knowledge/operations/docker-and-render.md
# Next.js on the Bun runtime, built inside the Bun workspace. The build stage installs from the root
# bun.lock, builds the standalone server and boots it once to check the home page renders; the
# runtime stage carries only that server, its traced modules and the static files.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY packages/platform/package.json packages/platform/
COPY packages/ui/package.json packages/ui/
COPY apps/adyen-digital/package.json apps/adyen-digital/
COPY apps/adyen-v6-styling/package.json apps/adyen-v6-styling/
COPY apps/adyen-agentic-commerce/package.json apps/adyen-agentic-commerce/
RUN bun install --frozen-lockfile
COPY packages ./packages
COPY testing ./testing
COPY tools/build ./tools/build
COPY apps/adyen-digital ./apps/adyen-digital
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd apps/adyen-digital typecheck && bun run --cwd apps/adyen-digital build
RUN bun tools/build/assert-built-ssr.ts apps/adyen-digital "Digital Checkout"

FROM oven/bun:1.4.4
WORKDIR /app
# __NEXT_PROCESSED_ENV keeps Next from re-expanding `$name` inside the Adyen key; HOSTNAME makes
# the server listen beyond loopback.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    __NEXT_PROCESSED_ENV=true \
    HOSTNAME=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/app/data/digital.sqlite
COPY --from=build /app/apps/adyen-digital/.next/standalone ./
COPY --from=build /app/apps/adyen-digital/.next/static ./apps/adyen-digital/.next/static
COPY tools/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && groupadd --gid 1993 app \
 && useradd --uid 1993 --gid 1993 --home-dir /home/app --no-create-home --shell /usr/sbin/nologin app \
 && install -d -o 1993 -g 1993 /app/data /home/app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT??'8000')+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Render mounts /var/data as root:1000, so the entrypoint starts as root only to chown the mount
# and /app/data to uid 1993, then drops privileges before the server starts.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["bun", "apps/adyen-digital/server.js"]
