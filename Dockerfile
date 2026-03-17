FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build the frontend
FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx fibrae build

# Production image
FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY generated ./generated
COPY migrations ./migrations
COPY worker ./worker
COPY .gmrc ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["bun", "server/index.ts"]
