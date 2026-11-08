# syntax=docker/dockerfile:1

# InvestSeek for self-hosting: a three-stage build on Node 22 (Alpine) that runs Next.js's standalone server as the
# unprivileged node user. docker-compose.yml wraps it; docs/deployment.md explains the settings.
#
#   docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t investseek .
#   docker run -d --name investseek --env-file .env.local -p 127.0.0.1:3000:3000 investseek
#
# The build downloads the IBM Plex fonts from Google Fonts (next/font), so it needs network access.

ARG NODE_VERSION=22

# 1. Dependencies, cached until package.json or the lockfile changes.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# 2. Production build. .next/cache is kept between builds to speed up rebuilds.
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

# 3. Runtime: the standalone server and its static assets, nothing else (the app has no public/ folder).
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
# HOSTNAME must be set: Docker would otherwise put the container id there and the server would not listen on
# 127.0.0.1, which the health check below uses.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Shown by /api/health as "commit". Set last, so a new commit does not invalidate the layers above.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
USER node
EXPOSE 3000
# Liveness only: /api/health never calls Yahoo, so an upstream outage cannot get the container marked unhealthy or
# restarted. Uptime monitors should use /api/health?ready=1 instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{process.exitCode=r.ok?0:1},()=>{process.exitCode=1})"]
CMD ["node", "server.js"]
