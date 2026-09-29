FROM node:22-slim AS builder
WORKDIR /app
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at container startup. Render's Blueprint YAML has no way to pass
# Docker build arguments (confirmed against Render's own docs -- no
# --build-arg equivalent exists), so a runtime envVar in render.yaml can't
# reach this step. Hardcoded here instead, since the backend's URL is
# already fixed by its `name:` in render.yaml and known ahead of time.
# If you rename the backend service, update this to match.
ENV NEXT_PUBLIC_API_BASE_URL=https://turbo-c-ide-backend.onrender.com
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --create-home --shell /usr/sbin/nologin nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
