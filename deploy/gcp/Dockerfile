# API image for Google Cloud e2-micro (SQLite on /data).
# Build from repo root:
#   docker build -f deploy/gcp/Dockerfile -t suraj-billing-api .
#
# Optional all-in-one (serve Vite build from the API too) for cutover testing:
#   docker build -f deploy/gcp/Dockerfile --build-arg SERVE_CLIENT=1 -t suraj-billing-api .

FROM node:20-bookworm-slim AS build

WORKDIR /app
ARG SERVE_CLIENT=0

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server/prisma ./server/prisma
RUN cd server && npx prisma generate
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/assets ./server/assets
RUN cd server && npm run build

# Optional: bake client for temporary same-origin hosting while Pages is set up.
COPY client/package.json client/package-lock.json ./client/
COPY client ./client
RUN if [ "$SERVE_CLIENT" = "1" ]; then \
      cd client && npm ci && VITE_API_URL=/api npm run build && \
      mkdir -p /app/server/public && cp -R /app/client/dist/. /app/server/public/; \
    else \
      mkdir -p /app/server/public; \
    fi

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL="file:/data/suraj.db"
# Keep Node heap small on Always Free e2-micro (~1 GiB shared).
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV TRUST_PROXY=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /data/backups \
  && chown -R node:node /data

COPY --from=build /app/server/package.json /app/server/package-lock.json ./server/
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/assets ./server/assets
COPY --from=build /app/server/public ./server/public
COPY deploy/gcp/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/server
# Run as root so the named volume at /data is writable on first boot, then drop
# privileges inside the entrypoint when possible.
EXPOSE 4000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/api/health | grep -q '"ok":true' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
