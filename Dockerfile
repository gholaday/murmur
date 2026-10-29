# syntax=docker/dockerfile:1.7

# ---------- runtime-base: Node (tags, chapters and durations are read in-process, no ffmpeg) ----------
FROM node:24-alpine AS runtime-base
RUN apk add --no-cache libc6-compat
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
COPY patches patches/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
# Built into the server code (next.config.ts), so a container recreated with an older image's
# environment, as Portainer's Recreate does, still reports the version it runs.
ARG MURMUR_VERSION=dev
RUN pnpm --filter @murmur/server test && MURMUR_VERSION=$MURMUR_VERSION pnpm --filter @murmur/server build
# The install also pulls the glibc builds of sharp and argon2; on Alpine only the musl ones
# load. Pruned here, before the copy, since deleting in a later layer wouldn't shrink the image.
RUN cd apps/server/.next/standalone/node_modules/.pnpm \
 && rm -rf @img+sharp-linux-* @img+sharp-libvips-linux-* @node-rs+argon2-linux-*-gnu@*

# ---------- runtime: plain Alpine plus the node binary ----------
# The Node image also carries npm, yarn and corepack (~25 MB), which nothing runs here.
# Keep this Alpine version in step with the one node:24-alpine is built on.
FROM alpine:3.24 AS runner
# No ffmpeg here: movies and shows are read and streamed by the video add-on (addons/video).
RUN apk add --no-cache libc6-compat libstdc++ libgcc tini su-exec
COPY --from=runtime-base /usr/local/bin/node /usr/local/bin/node
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
ARG MURMUR_VERSION=dev
ENV NODE_ENV=production \
    MURMUR_VERSION=$MURMUR_VERSION \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    EPISODE_CACHE_DIR=/cache \
    VIDEO_URL=http://murmur-video:3001 \
    MIGRATIONS_DIR=/app/apps/server/drizzle \
    PUID=1000 \
    PGID=1000
COPY --from=build /app/apps/server/.next/standalone ./
COPY --from=build /app/apps/server/.next/static ./apps/server/.next/static
COPY --from=build /app/apps/server/public ./apps/server/public
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY docker/entrypoint.sh /entrypoint.sh
# /cache works unmounted too, but its episodes are then lost when the container is recreated.
RUN chmod +x /entrypoint.sh && mkdir -p /cache
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "apps/server/server.js"]
