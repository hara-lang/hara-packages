#!/usr/bin/env bash
set -euo pipefail

: "${HARA_SITE_ORIGIN:?HARA_SITE_ORIGIN is required}"
: "${HARA_ASSET_VERSION:?HARA_ASSET_VERSION is required}"
origin="${HARA_SITE_ORIGIN%/}"
version="${HARA_ASSET_VERSION}"
[[ "$version" =~ ^[0-9a-f]{40}$ ]] || {
  echo "HARA_ASSET_VERSION must be one exact Git commit SHA." >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
assets=(
  "/|text/html|site/index.html"
  "/vendor/visual-language/hara-logo.svg|image/svg+xml|site/vendor/visual-language/hara-logo.svg"
  "/vendor/visual-language/theme.css|text/css|site/vendor/visual-language/theme.css"
  "/vendor/visual-language/tokens.css|text/css|site/vendor/visual-language/tokens.css"
  "/page.css|text/css|site/page.css"
  "/public-shell.css|text/css|site/public-shell.css"
  "/visual-refresh.css|text/css|site/visual-refresh.css"
  "/theme-toggle.js|javascript|site/theme-toggle.js"
  "/vendor/visual-language/theme.js|javascript|site/vendor/visual-language/theme.js"
  "/gallery.js|javascript|site/gallery.js"
  "/gallery.json|application/json|site/gallery.json"
)

for entry in "${assets[@]}"; do
  IFS='|' read -r path expected local_path <<< "$entry"
  name="$(printf '%s' "$path" | tr '/?=&' '____')"
  headers="$work/${name}.headers"
  body="$work/${name}.body"
  separator="?"
  [[ "$path" == *"?"* ]] && separator="&"
  status="$(curl --silent --show-error --location --compressed \
    --dump-header "$headers" \
    --output "$body" \
    --write-out '%{http_code}' \
    "${origin}${path}${separator}v=${version}")"

  [[ "$status" == "200" ]] || {
    echo "${path} returned HTTP ${status}." >&2
    exit 1
  }

  content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/ {sub(/^content-type:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0} END{print value}' "$headers")"
  case "$expected" in
    javascript)
      [[ "$content_type" =~ ^(application|text)/(javascript|x-javascript) ]] || {
        echo "${path} returned ${content_type}, not JavaScript." >&2
        exit 1
      }
      ;;
    *)
      [[ "$content_type" == "$expected"* ]] || {
        echo "${path} returned ${content_type}, expected ${expected}." >&2
        exit 1
      }
      ;;
  esac

  [[ -s "$body" ]] || {
    echo "${path} returned an empty body." >&2
    exit 1
  }

  local_hash="$(sha256sum "$local_path" | awk '{print $1}')"
  remote_hash="$(sha256sum "$body" | awk '{print $1}')"
  [[ "$remote_hash" == "$local_hash" ]] || {
    echo "${path} did not return the bytes deployed from ${local_path}." >&2
    echo "local=${local_hash} remote=${remote_hash}" >&2
    exit 1
  }
done

for reference in \
  "/vendor/visual-language/hara-logo.svg?v=${version}" \
  "/vendor/visual-language/theme.css?v=${version}" \
  "/page.css?v=${version}" \
  "/public-shell.css?v=${version}" \
  "/visual-refresh.css?v=${version}" \
  "/theme-toggle.js?v=${version}" \
  "/gallery.js?v=${version}"; do
  grep -Fq "$reference" "$work/_.body" || {
    echo "The live page does not reference ${reference}." >&2
    exit 1
  }
done
grep -Fq "tokens.css?v=${version}" "$work/_vendor_visual-language_theme.css.body"
grep -Fq "theme.js?v=${version}" "$work/_theme-toggle.js.body"
grep -Fq "gallery.json?v=\${ASSET_VERSION}" "$work/_gallery.js.body"
grep -Fq "const ASSET_VERSION = \"${version}\";" "$work/_gallery.js.body"

echo "Verified commit-addressed Packages assets at ${origin} for ${version}."
