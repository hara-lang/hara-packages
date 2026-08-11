import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPublicationCandidateIndex,
  publicationCandidateIndexSource,
  publicationRequestFiles,
  writePublicationCandidateIndex,
} from "../src/publication-candidates.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);

function request(packageId, version, sourceRoot) {
  const [owner, name] = packageId.split("/");
  return `{:hara/type :package-publication-request
 :request/format \"0.0.0-alpha\"
 :request/package
 {:package/name :${packageId}
  :package/version "${version}"
  :package/namespaces [:${owner}.${name}]}
 :request/source
 {:source/repository "${owner}/${name}"
  :source/branch "main"
  :source/commit "${COMMIT}"
  :source/root "${sourceRoot}"}
 :request/artifact
 {:artifact/archive "${owner}-${name}-${version}.harp"
  :artifact/sha256 "${DIGEST}"
  :artifact/signature "publisher-archive-signature"}
 :request/publisher
 {:publisher/key-id "publisher/${owner}"
  :publisher/signature-algorithm :ed25519}
 :request/reproducibility
 {:repro/build-command "hara package build"
  :repro/toolchain ["hara 0.1.0"]}
 :request/intent "Publish ${packageId} ${version}."}
`;
}

async function writeRequest(root, packageId, version, sourceRoot) {
  const [owner, name] = packageId.split("/");
  const directory = join(root, "requests", owner, name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${version}.edn`);
  await writeFile(path, request(packageId, version, sourceRoot));
  return path;
}

test("builds and sorts deterministic candidate projections from request files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hara-publication-candidates-"));
  try {
    await writeRequest(root, "zeta/widgets", "0.2.0", "packages/widgets");
    await writeRequest(root, "alpha/cards", "1.0.0", "packages/cards");
    await mkdir(join(root, "requests", "candidates"), { recursive: true });
    await writeFile(join(root, "requests", "candidates", "ignored.edn"), "(not registry data)");

    const files = await publicationRequestFiles(root);
    assert.deepEqual(files, [
      "requests/alpha/cards/1.0.0.edn",
      "requests/zeta/widgets/0.2.0.edn",
    ]);

    let fetched = false;
    const index = await buildPublicationCandidateIndex({
      root,
      fetchImpl: async () => {
        fetched = true;
        throw new Error("requests without Showcases must not fetch");
      },
    });
    assert.equal(fetched, false);
    assert.equal(index.format, "0.0.0-alpha");
    assert.equal(index.registry, "hara");
    assert.deepEqual(index.candidates.map((candidate) => candidate.package), [
      "alpha/cards",
      "zeta/widgets",
    ]);
    assert.deepEqual(index.candidates.map((candidate) => candidate.status), [
      "candidate",
      "candidate",
    ]);
    assert.match(index.candidates[0].candidateSha256, /^[0-9a-f]{64}$/);
    assert.equal(
      index.candidates[0].release.target,
      "packages/alpha/cards/1.0.0.edn",
    );

    const repeated = await buildPublicationCandidateIndex({ root });
    assert.equal(
      publicationCandidateIndexSource(repeated),
      publicationCandidateIndexSource(index),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes and checks the committed candidate index", async () => {
  const root = await mkdtemp(join(tmpdir(), "hara-publication-index-"));
  try {
    await writeRequest(root, "hara/example", "0.1.0", "packages/example");
    const built = await writePublicationCandidateIndex({ root });
    const committed = await readFile(
      join(root, "requests", "candidates", "index.json"),
      "utf8",
    );
    assert.equal(committed, publicationCandidateIndexSource(built));
    await writePublicationCandidateIndex({ root, check: true });

    await writeRequest(root, "hara/second", "0.1.0", "packages/second");
    await assert.rejects(
      () => writePublicationCandidateIndex({ root, check: true }),
      /requests\/candidates\/index\.json is stale/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
