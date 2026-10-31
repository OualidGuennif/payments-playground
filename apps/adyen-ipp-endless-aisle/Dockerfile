FROM denoland/deno:2.9.4

WORKDIR /app
ENV PORT=8000
ENV DATABASE_PATH=/app/data/ipp.sqlite

COPY deno.json deno.lock ./
COPY packages ./packages
COPY tools/dev ./tools/dev
COPY tools/build ./tools/build
COPY apps ./apps

RUN deno task build:ipp
RUN deno run -A tools/build/assert-built-ssr.ts apps/adyen-ipp-endless-aisle "Endless Aisle"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD deno eval "const p=Deno.env.get('PORT')??'8000';const r=await fetch('http://127.0.0.1:'+p+'/healthz');if(!r.ok)Deno.exit(1)"

CMD ["deno", "task", "--cwd", "apps/adyen-ipp-endless-aisle", "start"]
