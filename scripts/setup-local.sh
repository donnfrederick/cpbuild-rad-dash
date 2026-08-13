#!/usr/bin/env bash
# Start Docker services (Postgres + Mailpit), wait for DB, apply Prisma migrations.
# Prerequisites: Docker daemon running; see README.md "Local development".
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable."
  echo "  • Docker Desktop: start the app and wait until it is running."
  echo "  • Linux (engine): sudo systemctl start docker  (and ensure your user is in the docker group)"
  exit 1
fi

docker compose up -d

echo "Waiting for PostgreSQL (rad-dash-postgres)..."
ready=0
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres -d rad_dash >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Timed out waiting for PostgreSQL. Check: docker compose logs db"
  exit 1
fi
echo "PostgreSQL is ready."

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  else
    echo "Missing .env and .env.example"
    exit 1
  fi
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in .env."
  echo "For local Docker Postgres use:"
  echo '  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/rad_dash"'
  exit 1
fi

npx prisma migrate deploy
npx prisma db seed
echo ""
echo "Local stack is ready."
echo "  • App:        npm run dev   → http://localhost:3003"
echo "  • Login:      see prisma/seed.ts / README (local admin after seed)"
echo "  • Mailpit UI: http://localhost:18025  (when SMTP_HOST=127.0.0.1 SMTP_PORT=11025)"
