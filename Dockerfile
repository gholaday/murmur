# syntax=docker/dockerfile:1.7

# ---------- runtime-base: Node and ffmpeg (ffprobe reads tags, chapters and durations) ----------
FROM node:24-alpine AS runtime-base
RUN apk add --no-cache ffmpeg libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---------- base: adds pnpm for installing and building ----------
FROM runtime-base AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# ---------- deps: install with build tools for native modules ----------
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @murmur/server test && pnpm --filter @murmur/server build

# ---------- runtime ----------
FROM runtime-base AS runner
RUN apk add --no-cache tini su-exec
ARG MURMUR_VERSION=dev
ENV NODE_ENV=production \
    MURMUR_VERSION=$MURMUR_VERSION \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    LIBRARY_DIR=/audiobooks \
    MIGRATIONS_DIR=/app/apps/server/drizzle \
    PUID=1000 \
    PGID=1000
COPY --from=build /app/apps/server/.next/standalone ./
COPY --from=build /app/apps/server/.next/static ./apps/server/.next/static
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "apps/server/server.js"]
