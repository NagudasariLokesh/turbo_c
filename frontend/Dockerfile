FROM node:22-slim AS builder
WORKDIR /app
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at container startup -- so this has to be a build ARG passed to
# `docker build`, not just a runtime environment variable on the container.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
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
