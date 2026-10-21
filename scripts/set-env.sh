#!/usr/bin/env bash
# Sets one or more values in this project's .env, asking for each without showing it.
# Usage: bash scripts/set-env.sh META_APP_ID META_APP_SECRET
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
[ -f "$ENV_FILE" ] || { echo "No .env found at $ENV_FILE. Copy .env.example to .env first."; exit 1; }
[ $# -gt 0 ] || { echo "Usage: bash scripts/set-env.sh NAME [NAME...]"; exit 1; }

for NAME in "$@"; do
  [[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Skipping invalid name: $NAME"; continue; }
  printf "%s (won't be shown, Enter to skip): " "$NAME"
  stty -echo 2>/dev/null || true
  IFS= read -r VALUE
  stty echo 2>/dev/null || true
  echo
  VALUE="$(printf '%s' "$VALUE" | tr -d '[:space:]' | sed -e 's/^"//' -e 's/"$//')"
  if [ -z "$VALUE" ]; then
    echo "  skipped"
    continue
  fi
  NAME="$NAME" VALUE="$VALUE" python3 - "$ENV_FILE" <<'PY'
import os, re, sys
path, name, value = sys.argv[1], os.environ["NAME"], os.environ["VALUE"]
text = open(path).read()
line = f'{name}="{value}"'
pattern = rf"^{re.escape(name)}=.*$"
if re.search(pattern, text, flags=re.M):
    text = re.sub(pattern, lambda _: line, text, count=1, flags=re.M)
else:
    text = text.rstrip("\n") + "\n" + line + "\n"
open(path, "w").write(text)
PY
  echo "  saved (${#VALUE} characters, ends ...${VALUE: -3})"
done
