#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"

bundle_python() {
  local name="$1"
  local dest="$ROOT/backend/lambdas/${name}/.bundle"
  rm -rf "$dest"
  mkdir -p "$dest"
  "$PY" -m pip install \
    -r "$ROOT/backend/lambdas/${name}/requirements.txt" \
    -t "$dest" \
    --platform manylinux2014_x86_64 \
    --only-binary=:all: \
    --python-version 3.12 \
    --implementation cp \
    --upgrade
  cp "$ROOT/backend/lambdas/shared/"*.py "$dest/"
  cp "$ROOT/backend/lambdas/shared/schema.sql" "$dest/"
  cp "$ROOT/backend/lambdas/${name}/handler.py" "$dest/"
  find "$dest" -type d -name "__pycache__" -exec rm -rf {} +
  find "$dest" -type d -name "tests" -exec rm -rf {} +
  echo "Bundled ${name} -> ${dest}"
}

bundle_python ingest
bundle_python embed

mkdir -p "$ROOT/backend/lambdas/stop_rds/.bundle"
cp "$ROOT/backend/lambdas/stop_rds/handler.py" "$ROOT/backend/lambdas/stop_rds/.bundle/handler.py"
echo "Bundled stop_rds"

TOKENIZER_DEST="$ROOT/backend/lambdas/embed/.bundle/tokenizer.json"
if [ ! -f "$TOKENIZER_DEST" ]; then
  "$PY" - << 'PY'
from huggingface_hub import hf_hub_download
from pathlib import Path
path = hf_hub_download("Xenova/multilingual-e5-base", "tokenizer.json")
Path("backend/lambdas/embed/.bundle/tokenizer.json").write_bytes(Path(path).read_bytes())
print("tokenizer.json copied")
PY
fi
