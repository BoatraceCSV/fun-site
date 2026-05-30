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
# Stage 2: builder - Typecheck + tsc emit (shared + batch)
#
# tsx で TS を実行時 JIT すると Cloud Run Job のコールドスタートに 5〜10 秒
# 余計に積み上がる。ここでビルド済みの dist/ を作って runner では
# `node dist/main.js` で起動するように切り替える。
# ===========================================================================
FROM deps AS builder

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/batch/ ./packages/batch/
COPY packages/web/ ./packages/web/

# typecheck → shared を先にビルド (batch が production condition で dist/index.js を
# 参照するため) → batch をビルド
RUN pnpm --filter @fun-site/batch run typecheck \
 && pnpm --filter @fun-site/shared run build \
 && pnpm --filter @fun-site/batch run build

# ===========================================================================
# Stage 3: runner - Minimal production runtime
# ===========================================================================
FROM deps AS runner

# ビルド成果物 (shared/dist, batch/dist) のみ runner に持ち込む。
# packages/web は Astro ビルドのソース + node_modules/.bin/astro が必要なので丸ごとコピー。
# shared/src は Tailwind v4 の `@source` ディレクティブ
# (packages/web/src/styles/global.css) がスキャン対象として参照するため、
# runtime 実行ではなくビルド時 (web の Astro ビルド) に必要。
# これを含めないと race-grades.ts 等で動的に組み立てているクラス
# (`bg-amber-500 text-white` など) が production CSS に生成されない。
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/shared/src/ ./packages/shared/src/
COPY --from=builder /app/packages/batch/package.json ./packages/batch/
COPY --from=builder /app/packages/batch/dist/ ./packages/batch/dist/
COPY --from=builder /app/packages/web/ ./packages/web/

RUN chown -R node:node /app/packages/web/

USER node
WORKDIR /app/packages/batch

# ENTRYPOINT で固定し、追加引数 (Pub/Sub message の base64 など) は CMD/args 側で渡す。
# `--conditions=production` で `@fun-site/shared` の exports が dist/index.js に解決される。
# Cloud Run の containerOverrides.args 上書きで argv[2] 以降に Pub/Sub message が乗る前提。
# 注: Workflow `infra/realtime-pipeline.tf` の `containerOverrides.command` も
#     ここと一致させること（不一致だと "Cannot find module" になる）。
ENTRYPOINT ["node", "--conditions=production", "dist/main.js"]
CMD []
