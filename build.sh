#!/usr/bin/env bash
# Builds dist/web, dist/extension and dist/hf-space from web/ and extension/.
# Usage: ./build.sh [--bundle-models] [--model-url https://your-site/lang]
set -euo pipefail
cd "$(dirname "$0")"
BUNDLE=0; MODEL_URL="https://vaultsnip.pages.dev/lang"
while [[ $# -gt 0 ]]; do case "$1" in
  --bundle-models) BUNDLE=1; shift;;
  --model-url) MODEL_URL="$2"; shift 2;;
  *) echo "Unknown option $1"; exit 1;; esac; done

rm -rf dist && mkdir -p dist
# 1. Web app: everything, model included (served from the same site).
cp -r web dist/web

# 2. Extension: app copy without the model; the model downloads on first launch and is cached.
mkdir -p dist/extension
cp extension/manifest.json extension/background.js dist/extension/
cp -r web/icons dist/extension/icons
cp -r web dist/extension/app
if [[ $BUNDLE -eq 0 ]]; then
  rm -rf dist/extension/app/lang
  printf "window.VAULTSNIP_CONFIG = { langPath: '%s' };\n" "$MODEL_URL" > dist/extension/app/config.js
else
  # Store reviewers (Edge) refuse packages that contain compressed files, so the bundled model ships uncompressed.
  gunzip dist/extension/app/lang/eng.traineddata.gz
  printf "window.VAULTSNIP_CONFIG = { langPath: 'lang', langGzip: false };\n" > dist/extension/app/config.js
fi

# 3. Hugging Face static Space: a small page that shows the live web app, so the Space never falls behind a release.
#    (Uploading the whole app through the Hugging Face website drops its folders.)
mkdir -p dist/hf-space && cp tools/hf-space/index.html tools/hf-space/README.md dist/hf-space/

(cd dist && zip -qr vaultsnip-web.zip web && zip -qr vaultsnip-hf-space.zip hf-space)
# store packages need manifest.json at the root of the zip, not inside a folder
(cd dist/extension && zip -qrD ../vaultsnip-extension.zip .)
du -sh dist/web dist/extension dist/hf-space
echo "Built dist/. Extension model URL: $([[ $BUNDLE -eq 1 ]] && echo bundled || echo "$MODEL_URL")"
