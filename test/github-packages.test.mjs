import test from "node:test";
import assert from "node:assert/strict";
import {
  createCatalogCache,
  fetchArchive,
  imageRepository,
  resolveCatalog,
  sha256,
} from "../src/github-packages.mjs";

const sourceArchive = new TextEncoder().encode("source-harp");
const specsArchive = new TextEncoder().encode("specs-harp");
const semanticSourceArchive = new TextEncoder().encode("semantic-source-harp");
const semanticSpecsArchive = new TextEncoder().encode("semantic-specs-harp");
const sourceDigest = sha256(sourceArchive);
const specsDigest = sha256(specsArchive);
const semanticSourceDigest = sha256(semanticSourceArchive);
const semanticSpecsDigest = sha256(semanticSpecsArchive);
const sourceManifest = `sha256:${"a".repeat(64)}`;
const specsManifest = `sha256:${"b".repeat(64)}`;
const semanticSourceManifest = `sha256:${"c".repeat(64)}`;
const semanticSpecsManifest = `sha256:${"d".repeat(64)}`;

const semanticSourceName = "hara-lang.hara.packages.hara.lang.core";
const semanticSpecsName = `${semanticSourceName}.specs`;

function manifest({ kind, archive, coordinate, sourceCoordinate = coordinate }) {
  return {
    schemaVersion: 2,
    annotations: {
      "org.opencontainers.image.source": "https://github.com/hara-lang/hara",
      "org.opencontainers.image.revision": "c".repeat(40),
      "io.hara.package.coordinate": coordinate,
      "io.hara.package.source-coordinate": sourceCoordinate,
      "io.hara.package.kind": kind,
    },
    layers: [{
      mediaType: "application/vnd.hara.harp.v1+zip",
      digest: archive,
      size: archive === sourceDigest
        ? sourceArchive.byteLength
        : archive === semanticSourceDigest
          ? semanticSourceArchive.byteLength
          : archive === semanticSpecsDigest
            ? semanticSpecsArchive.byteLength
            : specsArchive.byteLength,
    }],
  };
}

function githubPackagesStub({ includeSemantic = false } = {}) {
  const seen = [];
  const sourceRepository = "hara-packages/hara-lang.hara";
  const specsRepository = "hara-packages/hara-lang.hara.specs";
  const names = [
    "hara-lang.hara",
    "hara-lang.hara.specs",
    ...(includeSemantic ? [semanticSourceName, semanticSpecsName] : []),
  ];
  const bearer = { "www-authenticate": "Bearer realm=\"https://ghcr.io/token\"" };
  return {
    seen,
    fetch: async (url, init = {}) => {
      const text = String(url);
      const authorization = new Headers(init.headers).get("authorization");
      seen.push({ text, authorization });
      if (text.startsWith("https://api.github.com/orgs/hara-packages/packages?")) {
        return Response.json(names.map((name) => ({ name })));
      }
      const versionMatch = text.match(/\/packages\/container\/([^/]+)\/versions\?/);
      if (versionMatch && names.includes(decodeURIComponent(versionMatch[1]))) {
        return Response.json([{ metadata: { container: { tags: ["0.1.0", "sha-not-a-release"] } } }]);
      }
      if (text.startsWith("https://ghcr.io/token?")) return Response.json({ token: "public-token" });
      if (text.includes("/manifests/0.1.0")) {
        if (authorization === null) return new Response(null, { status: 401, headers: bearer });
        const packageName = names.find((name) => text.includes(`/v2/hara-packages/${name}/manifests/0.1.0`));
        if (!packageName) throw new Error(`unexpected manifest ${text}`);
        const isSemantic = packageName === semanticSourceName || packageName === semanticSpecsName;
        const isSpecs = packageName.endsWith(".specs");
        const archive = isSemantic
          ? (isSpecs ? semanticSpecsDigest : semanticSourceDigest)
          : (isSpecs ? specsDigest : sourceDigest);
        const coordinate = isSemantic
          ? (isSpecs ? "hara:hara/lang.core.specs" : "hara:hara/lang.core")
          : (isSpecs ? "hara:hara/foundation.specs" : "hara:hara/foundation");
        const sourceCoordinate = isSemantic ? "hara:hara/lang.core" : "hara:hara/foundation";
        const manifestDigest = isSemantic
          ? (isSpecs ? semanticSpecsManifest : semanticSourceManifest)
          : (isSpecs ? specsManifest : sourceManifest);
        return Response.json(
          manifest({
            kind: isSpecs ? "specs" : "source",
            archive,
            coordinate,
            sourceCoordinate,
          }),
          { headers: { "docker-content-digest": manifestDigest } },
        );
      }
      if (text.includes(`/blobs/${sourceDigest}`) || text.includes(`/blobs/${semanticSourceDigest}`)) {
        if (authorization === null) return new Response(null, { status: 401, headers: bearer });
        return new Response(text.includes(`/blobs/${semanticSourceDigest}`) ? semanticSourceArchive : sourceArchive);
      }
      throw new Error(`unexpected fetch ${text}`);
    },
  };
}

test("package names map to the registered hara-packages GHCR organization", () => {
  assert.equal(imageRepository("hara-lang.hara"), "hara-packages/hara-lang.hara");
  assert.throws(() => imageRepository("../hara"));
});

test("catalog enumeration pairs matching source and specs OCI manifests by version and provenance", async () => {
  const stub = githubPackagesStub();
  const [entry] = await resolveCatalog({ fetchImpl: stub.fetch, env: { HARA_GITHUB_PACKAGES_READ_TOKEN: "read-token" } });
  assert.equal(entry.source.repository, "ghcr.io/hara-packages/hara-lang.hara");
  assert.equal(entry.source.manifest, sourceManifest);
  assert.equal(entry.source.archive, sourceDigest);
  assert.equal(entry.specs.repository, "ghcr.io/hara-packages/hara-lang.hara.specs");
  assert.equal(entry.specs.archive, specsDigest);
  assert.equal(entry.source.coordinate, "hara:hara/foundation");
  assert.equal(stub.seen.find(({ text }) => text.startsWith("https://api.github.com/")).authorization, "Bearer read-token");
});

test("catalog enumeration includes semantic source/spec pairs from the published package graph", async () => {
  const stub = githubPackagesStub({ includeSemantic: true });
  const entries = await resolveCatalog({ fetchImpl: stub.fetch });
  const entry = entries.find(({ source }) => source.coordinate === "hara:hara/lang.core");
  assert.ok(entry);
  assert.deepEqual(
    [entry.source.repository, entry.source.coordinate, entry.specs.repository, entry.specs.sourceCoordinate],
    [
      "ghcr.io/hara-packages/hara-lang.hara.packages.hara.lang.core",
      "hara:hara/lang.core",
      "ghcr.io/hara-packages/hara-lang.hara.packages.hara.lang.core.specs",
      "hara:hara/lang.core",
    ],
  );
});

test("archive reads verify the declared GHCR layer digest", async () => {
  const stub = githubPackagesStub();
  const [entry] = await resolveCatalog({ fetchImpl: stub.fetch });
  const bytes = await fetchArchive(entry.source, { fetchImpl: stub.fetch });
  assert.deepEqual(bytes, sourceArchive);
});

test("catalog cache is resettable and never becomes an authority after expiry", async () => {
  let now = 0;
  let calls = 0;
  const cache = createCatalogCache({
    now: () => now,
    ttl: 10,
    async resolve() { calls += 1; return [{ calls }]; },
  });
  assert.deepEqual(await cache.read(), [{ calls: 1 }]);
  assert.deepEqual(await cache.read(), [{ calls: 1 }]);
  now = 10;
  assert.deepEqual(await cache.read(), [{ calls: 2 }]);
  cache.reset();
  assert.deepEqual(await cache.read(), [{ calls: 3 }]);
});
