#!/bin/sh
# Keeps the Supabase Free Plan project from auto-pausing after 7 days of low
# activity. Connects straight to Postgres so it does not depend on the backend.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

# The backend URL carries a SQLAlchemy driver suffix that psql does not accept.
pg_url="$(printf '%s' "$DATABASE_URL" | sed 's#^postgresql+[a-z0-9]*://#postgresql://#')"

PGCONNECT_TIMEOUT=15 timeout 60 psql "$pg_url" \
  --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "select 'db-keepalive ok ' || now()::text;"
