FROM node:22.12-alpine AS builder
WORKDIR /app

# Copy deps files + prisma config first (needed for postinstall prisma generate)
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

RUN npm ci

# Copy the rest of the source and build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22.12-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy everything needed to run (node_modules keeps prisma CLI + dotenv available for migrations)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/i18n ./i18n

EXPOSE 3003

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && npm start"]
