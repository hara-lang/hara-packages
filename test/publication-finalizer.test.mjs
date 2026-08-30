import assert from "node:assert/strict";
import test from "node:test";
import { finalizePublication } from "../src/publication-finalizer.mjs";

function memoryObjects() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, Buffer.from(value)); },
    values,
  };
}

function input(archive = "harp-bytes") {
  return {
    intake: {
      coordinate: "hara:hara-native/smoke-answer",
      version: "0.1.0",
      source: { commit: "b".repeat(40), projectSha256: `sha256:${"d".repeat(64)}`, recipeSha256: `sha256:${"c".repeat(64)}` },
    },
    primaryBuild: { archive, projectSha256: `sha256:${"d".repeat(64)}`, builder: "github-actions/build" },
    verificationBuild: { archive, projectSha256: `sha256:${"d".repeat(64)}`, builder: "github-actions/verify" },
  };
}

test("protected finalization writes immutable bytes once and returns an attested release record", async () => {
  const objectStore = memoryObjects();
  const release = await finalizePublication({
    ...input(),
    objectStore,
    attest: async (statement) => `signed:${statement.length}`,
  });
  assert.equal(release["release/coordinate"], "hara:hara-native/smoke-answer");
  assert.match(release["release/archive-sha256"], /^sha256:[0-9a-f]{64}$/);
  assert.equal(objectStore.values.size, 1);
  const repeated = await finalizePublication({ ...input(), objectStore, attest: async () => "signed:repeat" });
  assert.equal(repeated["release/archive-sha256"], release["release/archive-sha256"]);
});

test("protected finalization refuses divergent independent builds before writing an object", async () => {
  const objectStore = memoryObjects();
  const candidate = input();
  candidate.verificationBuild.archive = "different-bytes";
  await assert.rejects(
    finalizePublication({ ...candidate, objectStore, attest: async () => "unreachable" }),
    /different archive bytes/,
  );
  assert.equal(objectStore.values.size, 0);
});

test("protected finalization refuses a build from project bytes other than the signed intent", async () => {
  const store = memoryObjects();
  await assert.rejects(finalizePublication({
    intake: {
      coordinate: "hara:hara-native/smoke-answer",
      version: "0.1.0",
      source: { commit: "b".repeat(40), projectSha256: `sha256:${"e".repeat(64)}`, recipeSha256: `sha256:${"c".repeat(64)}` },
    },
    primaryBuild: { archive: Buffer.from("archive"), projectSha256: `sha256:${"d".repeat(64)}`, builder: "github-actions/build" },
    verificationBuild: { archive: Buffer.from("archive"), projectSha256: `sha256:${"d".repeat(64)}`, builder: "github-actions/verify" },
    objectStore: store,
    attest: async () => "signature",
  }), /does not match the signed publication intent/);
  assert.equal(store.values.size, 0);
});
