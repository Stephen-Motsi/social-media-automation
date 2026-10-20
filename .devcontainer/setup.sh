#!/usr/bin/env bash
# Runs once when the dev container / Codespace is created.
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
  # Point at the compose services and generate local secrets.
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"|" .env
  sed -i "s|^REDIS_URL=.*|REDIS_URL=\"$REDIS_URL\"|" .env
  sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(openssl rand -base64 32)\"|" .env
  sed -i "s|^TOKEN_ENCRYPTION_KEY=.*|TOKEN_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"|" .env
  # In Codespaces the app is served from a forwarded URL, not localhost.
  if [ -n "${CODESPACE_NAME:-}" ]; then
    sed -i "s|^AUTH_URL=.*|AUTH_URL=\"https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}\"|" .env
  fi
  echo "Created .env. Fill in META_* and WHATSAPP_* values when you have them."
fi

npm install
npx prisma migrate deploy
npm run db:seed

echo "Ready. Run 'npm run dev' (and 'npm run worker' in another terminal)."
