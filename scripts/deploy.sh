#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
# shellcheck disable=SC1091
source "$HOME/.aws/env.sh"

bundle_python() {
  local name="$1"
  local dest="$ROOT/backend/lambdas/${name}/.bundle"
  rm -rf "$dest"
  mkdir -p "$dest"
  python3 -m pip install \
    -r "$ROOT/backend/lambdas/${name}/requirements.txt" \
    -t "$dest" \
    --upgrade
  cp "$ROOT/backend/lambdas/shared/"*.py "$dest/"
  cp "$ROOT/backend/lambdas/shared/schema.sql" "$dest/"
  cp "$ROOT/backend/lambdas/${name}/handler.py" "$dest/"
  find "$dest" -type d \( -name "__pycache__" -o -name "tests" -o -name "*.dist-info" \) -prune -false -o -type d -name "__pycache__" -print0 | xargs -0 rm -rf
  echo "Bundled ${name}"
}

bundle_python ingest
bundle_python embed

mkdir -p "$ROOT/backend/lambdas/stop_rds/.bundle"
cp "$ROOT/backend/lambdas/stop_rds/handler.py" "$ROOT/backend/lambdas/stop_rds/.bundle/handler.py"

python3 - << PY
from pathlib import Path
from huggingface_hub import hf_hub_download
dest = Path("$ROOT/backend/lambdas/embed/.bundle/tokenizer.json")
if not dest.exists():
    src = hf_hub_download("Xenova/multilingual-e5-base", "tokenizer.json")
    dest.write_bytes(Path(src).read_bytes())
    print("tokenizer.json copied")
PY

cd "$ROOT/frontend"
npm install
npx ng build --configuration production

cd "$ROOT/backend/infra"
npm install
npx cdk deploy --require-approval never
