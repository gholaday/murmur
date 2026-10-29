# syntax=docker/dockerfile:1.7
# Murmur's video add-on (murmur-video): ffmpeg for movies and shows. Built from the repo root,
# since it shares packages/shared with Murmur:  docker build -f addons/video/Dockerfile .

# ---------- build: bundle the add-on into one file ----------
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches patches/
COPY addons/video/package.json addons/video/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @murmur/video...
COPY packages/shared packages/shared/
COPY addons/video addons/video/
RUN pnpm --filter @murmur/video test && pnpm --filter @murmur/video build

# ---------- runtime: Alpine, node, ffmpeg and the GPU drivers ----------
# Keep this Alpine version in step with the one node:24-alpine is built on.
FROM alpine:3.24
# The VAAPI drivers let an Intel or AMD GPU convert video when /dev/dri is passed in; without one,
# conversion runs on the CPU.
RUN apk add --no-cache libstdc++ libgcc tini su-exec ffmpeg intel-media-driver libva-intel-driver mesa-va-gallium
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ARG MURMUR_VERSION=dev
ENV NODE_ENV=production \
    MURMUR_VERSION=$MURMUR_VERSION \
    VIDEO_PORT=3001 \
    CACHE_DIR=/cache \
    PUID=1000 \
    PGID=1000
COPY --from=build /app/addons/video/dist/main.js ./main.js
COPY addons/video/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /cache
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "main.js"]
