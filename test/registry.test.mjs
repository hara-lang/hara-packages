import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import handler, { blobUrl, manifestUrl, packageTag } from "../netlify/functions/registry.mjs";

const request = (path, method = "GET") =>
  new Request(`https://packages.hara-lang.org${path}`, { method });

const digest = (source) => `sha256:${createHash("sha256").update(source).digest("hex")}`;
const commit = "c".repeat(40);
const manifestDigest = `sha256:${"d".repeat(64)}`;
const source = '{:registry/packages {} :registry/namespaces {}}\n';

function registryManifest(overrides = {}) {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    annotations: {
      "org.opencontainers.image.source": "https://github.com/hara-lang/hara-packages",
      "org.opencontainers.image.revision": commit,
    },
    layers: [{
      mediaType: "application/vnd.hara.registry.v1+edn",
      digest: digest(source),
      size: Buffer.byteLength(source),
    }],
    ...overrides,
  };
}

function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = original; });
}

function ghcrStub({ manifest = registryManifest(), body = source } = {}) {
  const seen = [];
  const challenge = { "www-authenticate": "Bearer realm=\"https://ghcr.io/token\"" };
  return {
    seen,
    fetch: async (url, init = {}) => {
      const text = String(url);
      const authorization = new Headers(init.headers).get("authorization");
      seen.push({ url: text, authorization });
      if (text.startsWith("https://ghcr.io/token?")) return new Response(JSON.stringify({ token: "public-token" }));
      if (text.includes("/manifests/")) {
        if (authorization === null) return new Response(null, { status: 401, headers: challenge });
        return new Response(JSON.stringify(manifest), {
          headers: { "docker-content-digest": manifestDigest },
        });
      }
      if (text.includes("/blobs/")) {
        if (authorization === null) return new Response(null, { status: 401, headers: challenge });
        return new Response(body);
      }
      throw new Error(`unexpected fetch ${text}`);
    },
  };
}

test("registry package references only permit main or a 40-character commit", () => {
  assert.equal(packageTag("main"), "main");
  assert.equal(packageTag(commit), `sha-${commit}`);
  assert.equal(manifestUrl(commit), `https://ghcr.io/v2/hara-lang/hara-packages/manifests/sha-${commit}`);
  assert.equal(blobUrl(digest(source)), `https://ghcr.io/v2/hara-lang/hara-packages/blobs/${digest(source)}`);
  assert.throws(() => packageTag("../../etc/passwd"));
  assert.throws(() => packageTag("main;rm -rf /"));
  assert.throws(() => blobUrl("sha256:BAD"));
});

test("tap discovery document is served from the well-known path", async () => {
  const response = await handler(request("/.well-known/hara-tap.edn"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/edn; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
  const body = await response.text();
  assert.match(body, /:tap\/name "hara"/);
  assert.match(body, /:tap\/identity "https:\/\/id\.hara-lang\.org"/);
  assert.match(body, /:tap\/registry "https:\/\/packages\.hara-lang\.org"/);
});

test("main resolves the public GitHub Packages OCI artifact and verifies its registry layer", async () => {
  const stub = ghcrStub();
  await withFetch(stub.fetch, async () => {
    const response = await handler(request("/v1/registry"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/edn; charset=utf-8");
    assert.equal(response.headers.get("x-hara-authority"), "github-packages");
    assert.equal(response.headers.get("x-hara-registry-commit"), commit);
    assert.equal(response.headers.get("x-hara-registry-package"), `ghcr.io/hara-lang/hara-packages@${manifestDigest}`);
    assert.equal(response.headers.get("etag"), `"${manifestDigest}"`);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(await response.text(), source);
  });
  assert.deepEqual(stub.seen.map(({ url }) => url), [
    "https://ghcr.io/v2/hara-lang/hara-packages/manifests/main",
    "https://ghcr.io/token?service=ghcr.io&scope=repository%3Ahara-lang%2Fhara-packages%3Apull",
    "https://ghcr.io/v2/hara-lang/hara-packages/manifests/main",
    `https://ghcr.io/v2/hara-lang/hara-packages/blobs/${digest(source)}`,
    "https://ghcr.io/token?service=ghcr.io&scope=repository%3Ahara-lang%2Fhara-packages%3Apull",
    `https://ghcr.io/v2/hara-lang/hara-packages/blobs/${digest(source)}`,
  ]);
  assert.deepEqual(stub.seen.filter(({ authorization }) => authorization !== null).map(({ authorization }) => authorization), [
    "Bearer public-token",
    "Bearer public-token",
  ]);
});

test("commit-pinned package tags verify provenance and use immutable cache headers", async () => {
  const stub = ghcrStub();
  await withFetch(stub.fetch, async () => {
    const response = await handler(request(`/v1/registry?ref=${commit}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("x-hara-registry-commit"), commit);
  });
  assert.equal(stub.seen[0].url, `https://ghcr.io/v2/hara-lang/hara-packages/manifests/sha-${commit}`);
});

test("the authoritative registry document exposes package and namespace projections", async () => {
  const sourceFile = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../registry.edn", import.meta.url), "utf8"));
  assert.match(sourceFile, /:registry\/packages\s+\{\}/);
  assert.match(sourceFile, /:registry\/namespaces\s+\{\}/);
  assert.doesNotMatch(sourceFile, /package-release-preview[\s\S]*:registry\/namespaces/);
});

test("invalid ref, bad provenance and altered layer bytes fail closed", async () => {
  await withFetch(
    async () => { throw new Error("fetch must not be called"); },
    async () => {
      const response = await handler(request("/v1/registry?ref=../../etc/passwd"));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        await response.text(),
        '{:error/code :invalid-request :error/message "ref must be main or a 40-character commit"}\n',
      );
    },
  );
  const wrongCommit = registryManifest({ annotations: {
    "org.opencontainers.image.source": "https://github.com/hara-lang/hara-packages",
    "org.opencontainers.image.revision": "e".repeat(40),
  } });
  const provenanceStub = ghcrStub({ manifest: wrongCommit });
  await withFetch(provenanceStub.fetch, async () => {
    const response = await handler(request(`/v1/registry?ref=${commit}`));
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '{:error/code :upstream-unavailable :error/message "GitHub Packages registry artifact unavailable"}\n');
  });
  const bytesStub = ghcrStub({ body: "changed" });
  await withFetch(bytesStub.fetch, async () => {
    const response = await handler(request("/v1/registry"));
    assert.equal(response.status, 502);
  });
});

test("non-GET methods are a 405 EDN problem and HEAD preserves registry metadata", async () => {
  const post = await handler(request("/v1/registry", "POST"));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("cache-control"), "no-store");
  assert.equal(
    await post.text(),
    '{:error/code :method-not-allowed :error/message "public service endpoints are read-only"}\n',
  );
  const stub = ghcrStub();
  await withFetch(stub.fetch, async () => {
    const head = await handler(request("/v1/registry", "HEAD"));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("x-hara-authority"), "github-packages");
    assert.equal(await head.text(), "");
  });
});

test("unknown paths are a 404 EDN problem", async () => {
  const response = await handler(request("/nope"));
  assert.equal(response.status, 404);
  assert.equal(
    await response.text(),
    '{:error/code :not-found :error/message "unknown Hara platform endpoint"}\n',
  );
});
