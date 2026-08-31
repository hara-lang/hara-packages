import { createHash } from "node:crypto";
import { createCatalogCache } from "../../src/github-packages.mjs";

const COMMIT = /^[0-9a-f]{40}$/;
const cache = createCatalogCache();
const DISCOVERY = '{:tap/name "hara" :tap/registry "https://packages.hara-lang.org" :tap/trust :github-governed}\n';

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

function string(value) {
  return JSON.stringify(value);
}

function release(entry) {
  const { source, specs } = entry;
  return `{` + [
    `:oci/repository ${string(source.repository)}`,
    `:oci/manifest ${string(source.manifest)}`,
    `:archive-sha256 ${string(source.archive)}`,
    `:archive-size ${source.size}`,
    `:source {:repository ${string(source.source)} :revision ${string(source.revision)}}`,
    `:specs {:oci/repository ${string(specs.repository)} :oci/manifest ${string(specs.manifest)} :archive-sha256 ${string(specs.archive)} :archive-size ${specs.size}}`,
  ].join(" ") + `}`;
}

export function registryDocument(entries) {
  const packages = new Map();
  for (const entry of entries) {
    const versions = packages.get(entry.source.coordinate) ?? new Map();
    versions.set(entry.source.tag, release(entry));
    packages.set(entry.source.coordinate, versions);
  }
  const records = [...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([coordinate, versions]) => `${string(coordinate)} {${[...versions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([version, descriptor]) => `${string(version)} ${descriptor}`)
      .join(" ")}}`)
    .join(" ");
  return `{:registry/format "0.0.1" :registry/source {:kind :github-packages :organization "hara-packages"} :registry/packages {${records}} :registry/namespaces {}}\n`;
}

function catalogEtag(body) {
  return `"sha256:${createHash("sha256").update(body).digest("hex")}"`;
}

function checkRef(url) {
  const ref = url.searchParams.get("ref");
  if (ref === null || ref === "main") return null;
  if (COMMIT.test(ref)) return problem(410, "registry-commit-retired", "commit-pinned registries were retired; upgrade the package lock format");
  return problem(400, "invalid-request", "ref must be omitted or main");
}

export async function handle(request, { catalog = cache, env = process.env, fetchImpl = fetch } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "method-not-allowed", "public service endpoints are read-only");
  }
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/hara-tap.edn") {
    const response = edn(DISCOVERY, { headers: { "cache-control": "public, max-age=3600" } });
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
  if (url.pathname !== "/v1/registry") return problem(404, "not-found", "unknown Hara platform endpoint");
  const refProblem = checkRef(url);
  if (refProblem !== null) return refProblem;
  try {
    const body = registryDocument(await catalog.read({ env, fetchImpl }));
    const response = edn(body, {
      headers: {
        "cache-control": "public, max-age=0, must-revalidate",
        etag: catalogEtag(body),
        "x-hara-authority": "github-packages",
        "x-hara-registry-format": "0.0.1",
      },
    });
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } catch (error) {
    console.error(JSON.stringify({ event: "github-packages-catalog-failed", message: error?.message }));
    return problem(502, "upstream-unavailable", "GitHub Packages catalog unavailable");
  }
}

export default async (request) => handle(request);

export const config = { path: ["/.well-known/hara-tap.edn", "/v1/registry"] };
