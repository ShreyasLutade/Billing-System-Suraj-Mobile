FROM node:20-bookworm-slim AS build

WORKDIR /app

# Server deps + Prisma generate + TypeScript build
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server/prisma ./server/prisma
RUN cd server && npx prisma generate
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/assets ./server/assets
RUN cd server && npm run build

# Client build (API calls go to same origin /api)
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && VITE_API_URL=/api npm run build

# Assemble public assets next to server dist
RUN mkdir -p /app/server/public && cp -R /app/client/dist/. /app/server/public/

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/package.json /app/server/package-lock.json ./server/
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/assets ./server/assets
COPY --from=build /app/server/public ./server/public

WORKDIR /app/server
EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
