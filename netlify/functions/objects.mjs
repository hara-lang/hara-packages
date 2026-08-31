import { createCatalogCache, fetchArchive, HARP_LAYER_MEDIA_TYPE } from "../../src/github-packages.mjs";

const OBJECT_PATH = /^\/objects\/sha256\/([0-9a-f]{64})$/;
const cache = createCatalogCache();

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

function archiveEntry(entries, digest) {
  for (const { source, specs } of entries) {
    if (source.archive === digest) return source;
    if (specs.archive === digest) return specs;
  }
  return null;
}

function archiveHeaders(entry) {
  return {
    "content-type": HARP_LAYER_MEDIA_TYPE,
    "content-length": String(entry.size),
    etag: `"${entry.archive}"`,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "x-hara-authority": "github-packages",
    "x-hara-oci-manifest": entry.manifest,
  };
}

export async function handle(request, { catalog = cache, env = process.env, fetchImpl = fetch, loadArchive = fetchArchive } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "method-not-allowed", "public service endpoints are read-only");
  }
  const match = OBJECT_PATH.exec(new URL(request.url).pathname);
  if (match === null) return problem(404, "not-found", "unknown object path");
  const digest = `sha256:${match[1]}`;
  try {
    const entry = archiveEntry(await catalog.read({ env, fetchImpl }), digest);
    if (entry === null) return problem(404, "not-found", "object not found");
    const headers = archiveHeaders(entry);
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const bytes = await loadArchive(entry, { fetchImpl });
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "github-packages-object-failed", message: error?.message }));
    return problem(502, "upstream-unavailable", "GitHub Packages archive unavailable");
  }
}

export default async (request) => handle(request);

export const config = { path: "/objects/*" };
