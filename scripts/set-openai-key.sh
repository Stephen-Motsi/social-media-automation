#!/usr/bin/env bash
# Saves an OpenAI API key into this project's .env without showing it on screen.
# Usage: bash scripts/set-openai-key.sh
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
[ -f "$ENV_FILE" ] || { echo "No .env found at $ENV_FILE. Copy .env.example to .env first."; exit 1; }

printf "Paste your OpenAI key, then press Enter (it won't be shown): "
stty -echo 2>/dev/null || true
IFS= read -r KEY
stty echo 2>/dev/null || true
echo

# Trim whitespace and any surrounding quotes from the paste
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]' | sed -e 's/^"//' -e 's/"$//')"
if [ -z "$KEY" ]; then
  echo "Nothing was pasted. No changes made."
  exit 1
fi
case "$KEY" in sk-*) ;; *) echo "Warning: OpenAI keys usually start with 'sk-'. Saving anyway." ;; esac

# Replace the existing line, or add one if it's missing
KEY="$KEY" python3 - "$ENV_FILE" <<'PY'
import os, re, sys
path, key = sys.argv[1], os.environ["KEY"]
text = open(path).read()
line = f'OPENAI_API_KEY="{key}"'
if re.search(r"^OPENAI_API_KEY=.*$", text, flags=re.M):
    text = re.sub(r"^OPENAI_API_KEY=.*$", lambda _: line, text, count=1, flags=re.M)
else:
    text = text.rstrip("\n") + "\n" + line + "\n"
open(path, "w").write(text)
PY

echo "Saved to $ENV_FILE (key ending in ...${KEY: -4})."
