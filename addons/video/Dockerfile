# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# Murmur's video add-on (murmur-video): ffmpeg for movies and shows. Built from the repo root,
# since it shares packages/shared with Murmur:  docker build -f addons/video/Dockerfile .

# ---------- build: bundle the add-on into one file ----------
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# The same pnpm as packageManager in package.json, checked against its hash before it runs.
RUN corepack enable && corepack prepare pnpm@10.27.0+sha512.72d699da16b1179c14ba9e64dc71c9a40988cbdc65c264cb0e489db7de917f20dcf4d64d8723625f2969ba52d4b7e2a1170682d9ac2a5dcaeaab732b7e16f04a --activate
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
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
# The VAAPI drivers let an Intel or AMD GPU convert video when /dev/dri is passed in; without one,
# conversion runs on the CPU. Intel's drivers only exist for x86, so arm64 gets just the AMD one.
ARG TARGETARCH
RUN apk add --no-cache libstdc++ libgcc tini su-exec ffmpeg mesa-va-gallium \
 && if [ "$TARGETARCH" = "amd64" ]; then apk add --no-cache intel-media-driver libva-intel-driver; fi
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
