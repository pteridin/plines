FROM oven/bun:1-alpine AS base

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY bunfig.toml bun.lock package.json tsconfig.json ./
RUN bun install --frozen-lockfile

# Copy the remainder of the app source
COPY . .

# Build the client assets ahead of time so they are ready in the image
RUN bun run build.ts --outdir=dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
