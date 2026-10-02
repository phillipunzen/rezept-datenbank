FROM python:3.13-slim-bookworm@sha256:88310c082760d93ac7c74d579e95e53a4ab6ea52dd8901abc61a103daf488ac4 AS cookidoo
COPY scripts/cookidoo-requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --target /opt/cookidoo-sdk -r /tmp/requirements.txt

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates libbz2-1.0 libexpat1 libffi8 liblzma5 libsqlite3-0 libreadline8 libncursesw6 zlib1g libuuid1 && rm -rf /var/lib/apt/lists/*
COPY --from=cookidoo /usr/local/bin/python3.13 /usr/local/bin/python3.13
COPY --from=cookidoo /usr/local/lib/python3.13 /usr/local/lib/python3.13
COPY --from=cookidoo /usr/local/lib/libpython3.13.so.1.0 /usr/local/lib/libpython3.13.so.1.0
COPY --from=cookidoo /opt/cookidoo-sdk /opt/cookidoo-sdk
RUN ldconfig
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/.next/standalone ./.next/standalone
COPY --from=build --chown=node:node /app/.next/static ./.next/standalone/.next/static
COPY --from=build --chown=node:node /app/public ./.next/standalone/public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/entrypoint.sh"]
