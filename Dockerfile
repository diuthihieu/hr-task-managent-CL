# Node 24 (active LTS), the same major as CI, pinned by digest so every build
# uses the same image; Dependabot (docker) proposes digest updates.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Schema upgrades (docker compose run --rm migrate): the Prisma CLI from the
# lockfile, so `prisma migrate deploy` never downloads a different version at run
# time. Not root: the official image's `node` user (uid 1000).
FROM deps AS migrator
COPY prisma ./prisma
RUN npx --no-install prisma generate
USER node
CMD ["sh", "-c", "node prisma/check-legacy-data.mjs && npx --no-install prisma migrate deploy"]

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
