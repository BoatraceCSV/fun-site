# ===========================================================================
# Stage 1: deps - Install dependencies (cached layer)
# ===========================================================================
FROM node:22-alpine AS deps

RUN corepack enable
WORKDIR /app

# Copy only files needed for dependency resolution (maximizes Docker cache)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/batch/package.json ./packages/batch/
COPY packages/web/package.json ./packages/web/

# Install batch + web and their workspace dependencies
RUN pnpm install --frozen-lockfile --filter @fun-site/batch... --filter @fun-site/web...

# ===========================================================================
# Stage 2: builder - Copy source and verify TypeScript compilation
# ===========================================================================
FROM deps AS builder

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/batch/ ./packages/batch/
COPY packages/web/ ./packages/web/

RUN pnpm --filter @fun-site/batch run typecheck

# ===========================================================================
# Stage 3: runner - Minimal production runtime
# ===========================================================================
FROM deps AS runner

# Copy verified source files from builder (ensures typecheck passed)
# deps stage already has node_modules, so only source files are needed
COPY --from=builder /app/tsconfig.base.json ./
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/packages/batch/src/ ./packages/batch/src/
COPY --from=builder /app/packages/batch/tsconfig.json ./packages/batch/
COPY --from=builder /app/packages/batch/package.json ./packages/batch/
COPY --from=builder /app/packages/web/ ./packages/web/

RUN chown -R node:node /app/packages/web/src/content/ \
 && mkdir -p /app/packages/web/node_modules/.vite \
 && chown -R node:node /app/packages/web/node_modules/.vite

USER node
WORKDIR /app/packages/batch
CMD ["node", "--import", "tsx/esm", "src/main.ts"]
