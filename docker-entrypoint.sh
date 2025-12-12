#!/bin/sh
set -e

# Construct DATABASE_URL from postgres credentials if not already set
if [ -z "$DATABASE_URL" ]; then
  POSTGRES_USER="${POSTGRES_USER:-aerodrome}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-aerodrome}"
  POSTGRES_DB="${POSTGRES_DB:-aerodrome_agent}"
  POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
  POSTGRES_PORT="${POSTGRES_PORT:-5432}"
  
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  echo "📦 DATABASE_URL constructed from POSTGRES_* variables"
fi

echo "🗄️  Running database migrations..."
pnpm db:migrate

echo "🚀 Starting Aerodrome Trading Agent..."
exec pnpm tsx src/index.ts

