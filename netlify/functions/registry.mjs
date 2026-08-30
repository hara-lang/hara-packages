// Read-only registry endpoints for packages.hara-lang.org. The checked-in
// registry is projected into the public GitHub Container Registry as a small,
// provenance-labelled OCI artifact; this origin verifies and serves that
// artifact without needing GitHub credentials.

import { createHash } from "node:crypto";

const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:([0-9a-f]{64})$/;
const GHCR_ORIGIN = "https://ghcr.io";
const REGISTRY_REPOSITORY = "hara-lang/hara-packages";
const REGISTRY_SOURCE = `https://github.com/${REGISTRY_REPOSITORY}`;
const REGISTRY_LAYER_MEDIA_TYPE = "application/vnd.hara.registry.v1+edn";
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const MAX_REGISTRY_BYTES = 1024 * 1024;

const DISCOVERY = '{:tap/name "hara" :tap/identity "https://id.hara-lang.org" :tap/registry "https://packages.hara-lang.org"}\n';

function edn(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/edn; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { ...init, headers });
}

function problem(status, code, message) {
  return edn(`{:error/code :${code} :error/message ${JSON.stringify(message)}}\n`, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function packageTag(ref) {
  if (ref === "main") return "main";
  if (COMMIT.test(ref)) return `sha-${ref}`;
  throw new Error("ref must be main or a 40-character commit");
}

export function manifestUrl(ref) {
  return `${GHCR_ORIGIN}/v2/${REGISTRY_REPOSITORY}/manifests/${packageTag(ref)}`;
}

export function blobUrl(digest) {
  if (!DIGEST.test(digest)) throw new Error("digest must be a lowercase sha256 digest");
  return `${GHCR_ORIGIN}/v2/${REGISTRY_REPOSITORY}/blobs/${digest}`;
}

function tokenUrl() {
  const url = new URL("/token", GHCR_ORIGIN);
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${REGISTRY_REPOSITORY}:pull`);
  return url.toString();
}

async function ghcrFetch(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, init);
  if (response.status !== 401 || !/^Bearer\b/i.test(response.headers.get("www-authenticate") ?? "")) {
    return response;
  }
  const tokenResponse = await fetchImpl(tokenUrl());
  if (!tokenResponse.ok) return response;
  let token;
  try {
    token = (await tokenResponse.json()).token;
  } catch {
    return response;
  }
  if (typeof token !== "string" || token.length === 0) return response;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetchImpl(url, { ...init, headers });
}

function manifestCommit(manifest) {
  const annotations = manifest?.annotations;
  if (annotations?.["org.opencontainers.image.source"] !== REGISTRY_SOURCE) return null;
  const commit = annotations["org.opencontainers.image.revision"];
  return COMMIT.test(commit ?? "") ? commit : null;
}

function registryLayer(manifest) {
  if (manifest?.schemaVersion !== 2 || !Array.isArray(manifest.layers)) return null;
  const layers = manifest.layers.filter((layer) => layer?.mediaType === REGISTRY_LAYER_MEDIA_TYPE);
  if (layers.length !== 1) return null;
  const [layer] = layers;
  if (!DIGEST.test(layer.digest ?? "") || !Number.isInteger(layer.size) || layer.size < 0 || layer.size > MAX_REGISTRY_BYTES) {
    return null;
  }
  return layer;
}

function immutableCache(ref) {
  return COMMIT.test(ref)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

async function registryDocument(ref, fetchImpl = fetch) {
  try {
    packageTag(ref);
  } catch (error) {
    return problem(400, "invalid-request", error.message);
  }
  let manifestResponse;
  try {
    manifestResponse = await ghcrFetch(manifestUrl(ref), { headers: { accept: MANIFEST_ACCEPT } }, fetchImpl);
  } catch {
    console.error(JSON.stringify({ event: "github-packages-fetch-failed", kind: "manifest", ref }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  const manifestDigest = manifestResponse.headers.get("docker-content-digest");
  if (!manifestResponse.ok || !DIGEST.test(manifestDigest ?? "")) {
    console.error(JSON.stringify({ event: "github-packages-read-failed", kind: "manifest", ref, status: manifestResponse.status }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch {
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  const commit = manifestCommit(manifest);
  const layer = registryLayer(manifest);
  if (commit === null || layer === null || (COMMIT.test(ref) && commit !== ref)) {
    console.error(JSON.stringify({ event: "github-packages-provenance-invalid", ref }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  let blobResponse;
  try {
    blobResponse = await ghcrFetch(blobUrl(layer.digest), {}, fetchImpl);
  } catch {
    console.error(JSON.stringify({ event: "github-packages-fetch-failed", kind: "blob", ref }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  if (!blobResponse.ok) {
    console.error(JSON.stringify({ event: "github-packages-read-failed", kind: "blob", ref, status: blobResponse.status }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  let bytes;
  try {
    bytes = new Uint8Array(await blobResponse.arrayBuffer());
  } catch {
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== layer.size || actualDigest !== layer.digest) {
    console.error(JSON.stringify({ event: "github-packages-digest-invalid", ref }));
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  let body;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return problem(502, "upstream-unavailable", "GitHub Packages registry artifact unavailable");
  }
  return edn(body, {
    headers: {
      "cache-control": immutableCache(ref),
      etag: `"${manifestDigest}"`,
      "x-hara-authority": "github-packages",
      "x-hara-registry-commit": commit,
      "x-hara-registry-package": `ghcr.io/${REGISTRY_REPOSITORY}@${manifestDigest}`,
    },
  });
}

export default async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return problem(405, "method-not-allowed", "public service endpoints are read-only");
  }
  const url = new URL(req.url);
  if (url.pathname === "/.well-known/hara-tap.edn") {
    return edn(DISCOVERY, { headers: { "cache-control": "public, max-age=3600" } });
  }
  if (url.pathname === "/v1/registry") {
    const response = await registryDocument(url.searchParams.get("ref") ?? "main");
    return req.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
  return problem(404, "not-found", "unknown Hara platform endpoint");
};

export const config = { path: ["/.well-known/hara-tap.edn", "/v1/registry"] };
