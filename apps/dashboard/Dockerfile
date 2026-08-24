# ─── Build stage ────────────────────────────────────────
FROM oven/bun:1.3.10 AS builder
WORKDIR /app

COPY package.json bun.lock pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_PROXY=true
RUN bun install && cd apps/dashboard && bun run build

# ─── Production stage ──────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public
# WebSocket-capable entry (server terminal): wraps the standalone server to
# proxy `/api/proxy/*` upgrades to the internal API. See standalone-server.mjs.
COPY --from=builder /app/apps/dashboard/standalone-server.mjs ./apps/dashboard/standalone-server.mjs

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/dashboard/standalone-server.mjs"]
