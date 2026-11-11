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
COPY package.json .gmrc.cjs ./
COPY server/main.ts ./server/
COPY server/shell ./server/shell
COPY migrations ./migrations
COPY worker ./worker

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start"]
