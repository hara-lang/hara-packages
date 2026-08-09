#!/usr/bin/env bash
set -euo pipefail

: "${HARA_SITE_ORIGIN:?HARA_SITE_ORIGIN is required}"
origin="${HARA_SITE_ORIGIN%/}"
release="20260809-1"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

assets=(
  "/vendor/visual-language/theme.css?v=${release}|text/css"
  "/vendor/visual-language/tokens.css?v=${release}|text/css"
  "/page.css?v=${release}|text/css"
  "/public-shell.css?v=${release}|text/css"
  "/visual-refresh.css?v=${release}|text/css"
  "/theme-toggle.js?v=${release}|javascript"
  "/vendor/visual-language/theme.js?v=${release}|javascript"
  "/gallery.js?v=${release}|javascript"
  "/gallery.json|application/json"
)

for entry in "${assets[@]}"; do
  path="${entry%%|*}"
  expected="${entry#*|}"
  name="$(printf '%s' "$path" | tr '/?=&' '____')"
  headers="$work/${name}.headers"
  body="$work/${name}.body"
  status="$(curl --silent --show-error --location --compressed \
    --dump-header "$headers" \
    --output "$body" \
    --write-out '%{http_code}' \
    "${origin}${path}")"

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

  cache_control="$(awk 'BEGIN{IGNORECASE=1} /^cache-control:/ {sub(/^cache-control:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0} END{print value}' "$headers")"
  [[ "$cache_control" == *"max-age=0"* && "$cache_control" == *"must-revalidate"* ]] || {
    echo "${path} is still browser-cacheable without revalidation: ${cache_control}" >&2
    exit 1
  }

  [[ -s "$body" ]] || {
    echo "${path} returned an empty body." >&2
    exit 1
  }
done

curl --fail --silent --show-error --location --compressed \
  "${origin}/" > "$work/index.html"
for reference in \
  "/vendor/visual-language/theme.css?v=${release}" \
  "/page.css?v=${release}" \
  "/public-shell.css?v=${release}" \
  "/visual-refresh.css?v=${release}" \
  "/theme-toggle.js?v=${release}" \
  "/gallery.js?v=${release}"; do
  grep -Fq "$reference" "$work/index.html" || {
    echo "The live page does not reference ${reference}." >&2
    exit 1
  }
done

echo "Verified cache-safe Packages assets at ${origin}."
