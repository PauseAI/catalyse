# Node is pinned to an exact patch release: a Node security release reaches production by
# bumping this tag. Dockerfile.cron uses the same image.
FROM node:24.22.1-bookworm-slim

# openssl for the Prisma engines. pg_dump/pg_restore for the backup job and preview seeding:
# the client major must be >= the Railway Postgres service's major (pg_dump refuses newer
# servers), and Debian's postgresql-client lags behind, so take it from the PostgreSQL apt repo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

# Railway passes service variables to the build only when declared here. `prisma generate`
# reads DATABASE_URL; NEXT_PUBLIC_* values are inlined into the client bundle;
# RAILWAY_GIT_COMMIT_SHA becomes Next's deploymentId.
ARG DATABASE_URL
ARG RAILWAY_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
RUN npm run build:railway

ENV NODE_ENV=production

# The start-up scripts run through tsx, so devDependencies stay installed.
CMD ["sh", "-c", "npm run seed-preview && npm run migrate && exec node_modules/.bin/next start"]
