FROM node:22-slim AS builder
WORKDIR /app
# This Dockerfile is for the standalone multi-container path (see
# docker-compose.yml / sandbox/README.md), not the actual live deployment,
# which is a single Render web service (see README.md) where the backend
# serves this build directly as static files and NEXT_PUBLIC_API_BASE_URL
# is "" (same-origin). If you do run this standalone, point it at wherever
# your separately-hosted backend actually is.
ENV NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --create-home --shell /usr/sbin/nologin nextjs

# No `output: standalone` build (see next.config.ts) -- `next start` needs
# the full node_modules tree, not the trimmed standalone server bundle.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
