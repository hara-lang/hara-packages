import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../netlify/functions/objects.mjs";

const sourceDigest = `sha256:${"a".repeat(64)}`;
const specsDigest = `sha256:${"b".repeat(64)}`;
const request = (path, method = "GET") =>
  new Request(`https://packages.hara-lang.org${path}`, { method });

const entries = [{
  source: {
    archive: sourceDigest,
    manifest: `sha256:${"c".repeat(64)}`,
    repository: "ghcr.io/hara-packages/hara-lang.hara",
    size: 12,
  },
  specs: {
    archive: specsDigest,
    manifest: `sha256:${"d".repeat(64)}`,
    repository: "ghcr.io/hara-packages/hara-lang.hara.specs",
    size: 8,
  },
}];

const catalog = { async read() { return entries; } };

test("objects serve only digest-addressed HARP layers declared by the GHCR catalog", async () => {
  const seen = [];
  const response = await handle(request(`/objects/sha256/${sourceDigest.slice(7)}`), {
    catalog,
    async loadArchive(entry) {
      seen.push(entry);
      return new TextEncoder().encode("source-bytes");
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/vnd.hara.harp.v1+zip");
  assert.equal(response.headers.get("content-length"), "12");
  assert.equal(response.headers.get("etag"), `"${sourceDigest}"`);
  assert.equal(response.headers.get("x-hara-oci-manifest"), entries[0].source.manifest);
  assert.equal(await response.text(), "source-bytes");
  assert.deepEqual(seen, [entries[0].source]);
});

test("HEAD exposes immutable GHCR layer metadata without retrieving archive bytes", async () => {
  const response = await handle(request(`/objects/sha256/${specsDigest.slice(7)}`, "HEAD"), {
    catalog,
    async loadArchive() { throw new Error("HEAD must not download"); },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "8");
  assert.equal(await response.text(), "");
});

test("objects reject invalid paths, unknown digests, writes, and upstream archive failures", async () => {
  const invalid = await handle(request("/objects/sha256/ABC"), { catalog });
  assert.equal(invalid.status, 404);
  const absent = await handle(request(`/objects/sha256/${"e".repeat(64)}`), { catalog });
  assert.equal(absent.status, 404);
  const write = await handle(request(`/objects/sha256/${sourceDigest.slice(7)}`, "POST"), { catalog });
  assert.equal(write.status, 405);
  const unavailable = await handle(request(`/objects/sha256/${sourceDigest.slice(7)}`), {
    catalog,
    async loadArchive() { throw new Error("digest mismatch"); },
  });
  assert.equal(unavailable.status, 502);
  assert.equal(await unavailable.text(), '{:error/code :upstream-unavailable :error/message "GitHub Packages archive unavailable"}\n');
});
