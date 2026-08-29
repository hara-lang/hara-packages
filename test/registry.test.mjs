import test from "node:test";
import assert from "node:assert/strict";
import handler, { upstreamUrl } from "../netlify/functions/registry.mjs";

const request = (path, method = "GET") =>
  new Request(`https://packages.hara-lang.org${path}`, { method });

const ednBody = (source = "{:packages {}}") => new Response(source, { status: 200 });

function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = original; });
}

test("upstreamUrl only permits main or a 40-character commit", () => {
  assert.equal(
    upstreamUrl("main"),
    "https://raw.githubusercontent.com/hara-lang/hara-packages/main/registry.edn",
  );
  const commit = "a".repeat(40);
  assert.equal(
    upstreamUrl(commit),
    `https://raw.githubusercontent.com/hara-lang/hara-packages/${commit}/registry.edn`,
  );
  assert.throws(() => upstreamUrl("../../etc/passwd"));
  assert.throws(() => upstreamUrl("main;rm -rf /"));
  assert.throws(() => upstreamUrl("A".repeat(40)));
  assert.throws(() => upstreamUrl("a".repeat(39)));
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

test("main resolves to an exact commit before serving an immutable registry document", async () => {
  const commit = "c".repeat(40);
  const seen = [];
  await withFetch(async (url) => {
    seen.push(url);
    if (url.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: commit }));
    return ednBody(`;; fetched ${url}`);
  }, async () => {
    const response = await handler(request("/v1/registry"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/edn; charset=utf-8");
    assert.equal(response.headers.get("x-hara-authority"), "git");
    assert.equal(response.headers.get("x-hara-registry-commit"), commit);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(seen, [
      "https://api.github.com/repos/hara-lang/hara-packages/commits/main",
      `https://raw.githubusercontent.com/hara-lang/hara-packages/${commit}/registry.edn`,
    ]);
    const body = await response.text();
    assert.match(body, new RegExp(`/hara-lang/hara-packages/${commit}/registry\\.edn`));
  });
});

test("the authoritative registry document exposes package and namespace projections", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../registry.edn", import.meta.url), "utf8"));
  assert.match(source, /:registry\/packages\s+\{\}/);
  assert.match(source, /:registry\/namespaces\s+\{\}/);
  assert.doesNotMatch(source, /package-release-preview[\s\S]*:registry\/namespaces/);
});

test("commit-pinned registry reads are immutable and long-cached", async () => {
  const commit = "b".repeat(40);
  await withFetch(async () => ednBody(), async () => {
    const response = await handler(request(`/v1/registry?ref=${commit}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("x-hara-registry-commit"), commit);
  });
});

test("invalid refs are a 400 EDN problem and never reach the network", async () => {
  await withFetch(
    async () => { throw new Error("fetch must not be called"); },
    async () => {
      const response = await handler(request("/v1/registry?ref=../../etc/passwd"));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("content-type"), "application/edn; charset=utf-8");
      assert.equal(
        await response.text(),
        '{:error/code :invalid-request :error/message "ref must be main or a 40-character commit"}\n',
      );
    },
  );
});

test("upstream failure is a 502 EDN problem", async () => {
  const commit = "e".repeat(40);
  await withFetch(async (url) => {
    if (url.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: commit }));
    return new Response("nope", { status: 404 });
  }, async () => {
    const response = await handler(request("/v1/registry"));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      await response.text(),
      '{:error/code :upstream-unavailable :error/message "authoritative Git document unavailable"}\n',
    );
  });
});

test("non-GET methods are a 405 EDN problem", async () => {
  const response = await handler(request("/v1/registry", "POST"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    '{:error/code :method-not-allowed :error/message "public service endpoints are read-only"}\n',
  );
});

test("unknown paths are a 404 EDN problem", async () => {
  const response = await handler(request("/nope"));
  assert.equal(response.status, 404);
  assert.equal(
    await response.text(),
    '{:error/code :not-found :error/message "unknown Hara platform endpoint"}\n',
  );
});

test("HEAD is accepted like GET", async () => {
  const response = await handler(request("/.well-known/hara-tap.edn", "HEAD"));
  assert.equal(response.status, 200);
});
