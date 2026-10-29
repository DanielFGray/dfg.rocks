FROM oven/bun:1.4.4 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json .gmrc serve.ts ./
COPY migrations ./migrations
COPY worker ./worker
# The worker reads its configuration through the server's env schema.
COPY server/assertEnv.ts ./server/assertEnv.ts

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start"]
