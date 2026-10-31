FROM denoland/deno:2.9.4

WORKDIR /app
ENV PORT=8000
ENV DATABASE_PATH=/app/data/agentic.sqlite

COPY deno.json deno.lock ./
COPY packages ./packages
COPY tools/dev ./tools/dev
COPY tools/build ./tools/build
COPY apps ./apps

RUN deno task build:agentic
RUN deno run -A tools/build/assert-built-ssr.ts apps/adyen-agentic-commerce "Agentic Commerce"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD deno eval "const p=Deno.env.get('PORT')??'8000';const r=await fetch('http://127.0.0.1:'+p+'/healthz');if(!r.ok)Deno.exit(1)"

# The TEST-only Render service keeps the image's default user: the persistent disk's
# ownership is not guaranteed writable by a non-root UID. Revisit before production.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["deno", "task", "--cwd", "apps/adyen-agentic-commerce", "start"]
