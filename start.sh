#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22.13+ is required. Read README_RU.md.'
  exit 1
fi
exec node --env-file-if-exists=.env server/index.mjs
