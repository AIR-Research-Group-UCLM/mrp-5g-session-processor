# Build stage
FROM node:22-alpine AS builder

# Build arguments
ARG VITE_BASE_PATH=/

# Install build dependencies for native modules (better-sqlite3, argon2)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Copy all source files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

# Install all dependencies (including native module compilation)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build with VITE_BASE_PATH for frontend assets
RUN VITE_BASE_PATH=${VITE_BASE_PATH} NODE_ENV=production pnpm run -r build

# Copy non-TS files that TypeScript doesn't handle
RUN cp packages/backend/src/db/schema.sql packages/backend/dist/db/

# Compile seed script separately
RUN pnpm exec tsc packages/backend/scripts/seed-users.ts --outDir packages/backend/dist/scripts --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck

RUN pnpm deploy --filter=backend --prod /prod

# Copy workspace dependency (shared) - pnpm deploy creates a broken symlink
RUN rm -rf /prod/node_modules/@mrp/shared && cp -r packages/shared /prod/node_modules/@mrp/shared

# Copy compiled seed script
RUN cp packages/backend/dist/scripts/seed-users.js /prod/scripts/

# Copy frontend build to serve as static files
RUN cp -r packages/frontend/dist/ /prod/public/


# Production stage
FROM node:22-alpine AS runner

# Install runtime dependencies (ffmpeg for audio extraction)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy production build from builder
COPY --from=builder /prod ./

# Create data directory for SQLite and set permissions
RUN mkdir -p data && chown -R node:node /app

USER node

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
