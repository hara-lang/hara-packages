import test from "node:test";
import assert from "node:assert/strict";
import handler, { handle, registryDocument } from "../netlify/functions/registry.mjs";

const request = (path, method = "GET") =>
  new Request(`https://packages.hara-lang.org${path}`, { method });

const entry = {
  source: {
    coordinate: "hara:hara/foundation",
    tag: "0.1.0",
    repository: "ghcr.io/hara-packages/hara-lang.hara",
    manifest: `sha256:${"a".repeat(64)}`,
    archive: `sha256:${"b".repeat(64)}`,
    size: 42,
    source: "https://github.com/hara-lang/hara",
    revision: "c".repeat(40),
  },
  specs: {
    repository: "ghcr.io/hara-packages/hara-lang.hara.specs",
    manifest: `sha256:${"d".repeat(64)}`,
    archive: `sha256:${"e".repeat(64)}`,
    size: 24,
  },
};

function catalog(entries = [entry]) {
  return { async read() { return entries; } };
}

test("registry projects paired GHCR source and specs descriptors into one deterministic document", () => {
  const body = registryDocument([entry]);
  assert.match(body, /:registry\/format "0\.0\.1"/);
  assert.match(body, /:registry\/source \{:kind :github-packages :organization "hara-packages"\}/);
  assert.match(body, /"hara:hara\/foundation"/);
  assert.match(body, /:oci\/repository "ghcr\.io\/hara-packages\/hara-lang\.hara"/);
  assert.match(body, /:specs \{:oci\/repository "ghcr\.io\/hara-packages\/hara-lang\.hara\.specs"/);
  assert.match(body, /:registry\/namespaces \{\}/);
});

test("tap discovery is GitHub-governed and has no identity-registry dependency", async () => {
  const response = await handle(request("/.well-known/hara-tap.edn"), { catalog: catalog() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/edn; charset=utf-8");
  assert.match(await response.text(), /:tap\/trust :github-governed/);
  assert.doesNotMatch(await handle(request("/.well-known/hara-tap.edn"), { catalog: catalog() }).then((value) => value.text()), /:tap\/identity/);
});

test("registry reads its live catalog through the injected GitHub Packages resolver", async () => {
  const response = await handle(request("/v1/registry?ref=main"), { catalog: catalog() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-hara-authority"), "github-packages");
  assert.equal(response.headers.get("x-hara-registry-format"), "0.0.1");
  assert.match(response.headers.get("etag"), /^"sha256:[0-9a-f]{64}"$/);
  assert.match(await response.text(), /"0\.1\.0"/);
});

test("retired commit-pinned registries fail with an explicit migration error", async () => {
  const response = await handle(request(`/v1/registry?ref=${"c".repeat(40)}`), { catalog: catalog() });
  assert.equal(response.status, 410);
  assert.equal(
    await response.text(),
    '{:error/code :registry-commit-retired :error/message "commit-pinned registries were retired; upgrade the package lock format"}\n',
  );
});

test("registry validates requests, preserves HEAD metadata, and fails closed on catalog errors", async () => {
  const badRef = await handle(request("/v1/registry?ref=branch"), { catalog: catalog() });
  assert.equal(badRef.status, 400);
  const post = await handle(request("/v1/registry", "POST"), { catalog: catalog() });
  assert.equal(post.status, 405);
  const head = await handle(request("/v1/registry", "HEAD"), { catalog: catalog() });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const unavailable = await handle(request("/v1/registry"), {
    catalog: { async read() { throw new Error("unavailable"); } },
  });
  assert.equal(unavailable.status, 502);
  const unknown = await handler(request("/nope"));
  assert.equal(unknown.status, 404);
});
