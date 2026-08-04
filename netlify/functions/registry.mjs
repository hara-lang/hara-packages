// Read-only registry endpoints for packages.hara-lang.org, mirroring the
// Cloudflare worker router (platform/cloudflare/src/router.ts). The registry
// of record is the Git repository; this origin only serves it.

const COMMIT = /^[0-9a-f]{40}$/;

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

// Exported for tests. Throws on anything that is not `main` or a commit so a
// crafted ref can never reach the upstream URL.
export function upstreamUrl(ref) {
  if (ref !== "main" && !COMMIT.test(ref)) {
    throw new Error("ref must be main or a 40-character commit");
  }
  // raw.githubusercontent.com is CDN-fronted; the api.github.com contents
  // endpoint rate-limits shared egress IPs and 502s in practice.
  return `https://raw.githubusercontent.com/hara-lang/hara-packages/${ref}/registry.edn`;
}

async function registryDocument(url) {
  const ref = url.searchParams.get("ref") ?? "main";
  let upstream;
  try {
    upstream = upstreamUrl(ref);
  } catch (error) {
    return problem(400, "invalid-request", error.message);
  }
  const response = await fetch(upstream, { headers: { "user-agent": "hara-packages" } });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "git-read-failed", kind: "registry", ref, status: response.status }));
    return problem(502, "upstream-unavailable", "authoritative Git document unavailable");
  }
  return edn(response.body, {
    headers: {
      "cache-control": ref === "main"
        ? "public, max-age=60"
        : "public, max-age=31536000, immutable",
      "x-hara-authority": "git",
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
    return registryDocument(url);
  }
  return problem(404, "not-found", "unknown Hara platform endpoint");
};

export const config = { path: ["/.well-known/hara-tap.edn", "/v1/registry"] };
