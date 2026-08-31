import test from "node:test";
import assert from "node:assert/strict";
import { receiptPath, verifyReceipt } from "../scripts/verify-publication-receipt.mjs";

const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const policy = {
  format: "hara-package-sources/1",
  sources: {
    "hara-lang/hara": {
      coordinate: "hara:hara/foundation",
      projectPath: ".",
      requestWorkflow: ".github/workflows/package-publication-request.yml",
      nativeRepository: "hara-lang/hara-native",
      nativeTagPrefix: "v",
      specPath: "spec",
    },
  },
};

function receipt(overrides = {}) {
  return {
    format: "hara-package-receipt/1",
    source: {
      repository: "hara-lang/hara",
      coordinate: "hara:hara/foundation",
      projectPath: ".",
      tag: "0.1.0",
      version: "0.1.0",
      commit,
      projectSha256: digest,
      recipePath: "project.recipe.edn",
      recipeSha256: digest,
      native: { repository: "hara-lang/hara-native", version: "0.1.14", tag: "v0.1.14", revision: commit },
    },
    specs: { path: "spec", gitTree: "absent" },
    signature: { bundle: "requests/hara-lang.hara/0.1.0.sigstore.json" },
    ...overrides,
  };
}

const location = { path: "requests/hara-lang.hara/0.1.0.json", image: "hara-lang.hara", version: "0.1.0" };

test("receipt paths are fixed to the GHCR owner.repo image and semver tag", () => {
  assert.deepEqual(receiptPath("/repo", "/repo/requests/hara-lang.hara/0.1.0.json"), location);
  assert.throws(() => receiptPath("/repo", "/repo/requests/hara-lang/hara.json"));
});

test("a receipt binds one approved source tag, released native version/tag/revision, and paired specs archive", () => {
  const checked = verifyReceipt(receipt(), policy, location);
  assert.equal(checked.image, "hara-lang.hara");
  assert.equal(checked.coordinate, "hara:hara/foundation");
  assert.equal(checked.bundle, "requests/hara-lang.hara/0.1.0.sigstore.json");
  assert.equal(checked.nativeVersion, "0.1.14");
  assert.equal(checked.nativeTag, "v0.1.14");
});

test("receipt validation rejects a changed coordinate, mutable source, or detached signature", () => {
  assert.throws(() => verifyReceipt(receipt({ source: { ...receipt().source, coordinate: "hara:other/package" } }), policy, location));
  assert.throws(() => verifyReceipt(receipt({ source: { ...receipt().source, commit: "main" } }), policy, location));
  assert.throws(() => verifyReceipt(receipt({ source: { ...receipt().source, native: { ...receipt().source.native, tag: "v0.1.12" } } }), policy, location));
  assert.throws(() => verifyReceipt(receipt({ signature: { bundle: "outside.sigstore.json" } }), policy, location));
});
