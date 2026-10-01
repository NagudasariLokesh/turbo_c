FROM node:22-slim AS builder
WORKDIR /app
# next.config.ts sets output: "export" -- NEXT_PUBLIC_API_BASE_URL is baked
# into the static bundle at build time. Default "" makes the frontend call
# relative /api/... paths, which this stack's nginx.conf proxies to the
# backend container under the same origin (mirrors the single-service
# Render deployment's same-origin design -- see ../README.md).
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# `output: "export"` produces a static frontend/out/ with no server-side
# runtime at all -- `next start` does NOT support static-export builds
# (confirmed by actually running it: the process logs nothing and never
# binds a port), so the runner here is plain nginx serving the exported
# files, not a Node process.
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
