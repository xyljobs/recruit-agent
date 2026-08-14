FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# 子路径部署（如 /zhaopin）时通过 build arg 注入，构建期内联进客户端产物
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate && pnpm build && pnpm worker:build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=5000
# 运行期服务端（proxy 重定向 / 服务端 redirect）同样需要 basePath
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/assets/*.md ./assets/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start.mjs ./scripts/start.mjs
COPY --from=builder --chown=nextjs:nodejs /app/dist-workers ./dist-workers

USER nextjs
EXPOSE 5000
CMD ["node", "scripts/start.mjs"]
