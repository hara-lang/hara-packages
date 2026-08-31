import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  canonicalAuthorization,
  parsePublicationIntent,
  verifyPublicationSubmission,
} from "../src/publication-submission.mjs";

const REVISION = "a".repeat(40);
const NOW = 1_700_000_000_000;

function rawKey(key) {
  return key.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
}

function intent() {
  return `{:intent/format "0.0.0-alpha" :tap "hara" :coordinate "hara:hara-native/smoke-answer" :version "0.1.0" :repository "git@github.com:hara-lang/hara-native.git" :tag "0.1.0" :commit "${"b".repeat(40)}" :project-sha256 "sha256:${"c".repeat(64)}" :recipe-sha256 "sha256:${"d".repeat(64)}" :identity-revision "${REVISION}"}\n`;
}

function submission() {
  const publisher = generateKeyPairSync("ed25519");
  const authorization = generateKeyPairSync("ed25519");
  const source = intent();
  const payload = {
    authorization: "hara-publisher/1",
    keyId: "hoebat-2026-01",
    githubSubject: "1455572",
    coordinate: "hara:hara-native/smoke-answer",
    intentSha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    identityRevision: REVISION,
    nonce: "x".repeat(32),
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
  return {
    submission: {
      intent: source,
      key_id: payload.keyId,
      signature: sign(null, Buffer.from(source), publisher.privateKey).toString("hex"),
      authorization: {
        payload,
        signature: sign(null, Buffer.from(canonicalAuthorization(payload)), authorization.privateKey).toString("hex"),
      },
    },
    policy: {
      revision: REVISION,
      authorizationPublicKey: rawKey(authorization.publicKey),
      publisherKeys: {
        "hoebat-2026-01": {
          publicKey: rawKey(publisher.publicKey),
          githubSubject: "1455572",
          coordinates: ["hara:hara-native/smoke-answer"],
          namespaceOwners: [],
          revoked: false,
        },
      },
    },
  };
}

test("accepts a publication submission only when both publisher and Identity signatures bind the intent", () => {
  const { submission: value, policy } = submission();
  const accepted = verifyPublicationSubmission(value, policy, { now: NOW });
  assert.equal(accepted.intent.coordinate, "hara:hara-native/smoke-answer");
  assert.equal(accepted.keyId, "hoebat-2026-01");
  assert.equal(accepted.githubSubject, "1455572");
  assert.equal(parsePublicationIntent(value.intent).tag, "0.1.0");
});

test("rejects a valid authorization replayed for a changed intent", () => {
  const { submission: value, policy } = submission();
  value.intent = value.intent.replace('"0.1.0"', '"0.1.1"');
  assert.throws(() => verifyPublicationSubmission(value, policy, { now: NOW }), /intent signature|does not bind/);
});

test("rejects expired authorization even when the publisher signature is valid", () => {
  const { submission: value, policy } = submission();
  value.authorization.payload.expiresAt = new Date(NOW - 1).toISOString();
  assert.throws(() => verifyPublicationSubmission(value, policy, { now: NOW }), /authorization has expired/);
});

test("rejects a valid service authorization from a GitHub subject other than the granted publisher", () => {
  const { submission: value, policy } = submission();
  policy.publisherKeys["hoebat-2026-01"].githubSubject = "999999";
  assert.throws(() => verifyPublicationSubmission(value, policy, { now: NOW }), /GitHub subject is not authorized/);
});

test("identifies an authorization payload with the wrong protocol discriminator", () => {
  const { submission: value, policy } = submission();
  value.authorization.payload.authorization = "hara-publisher/0";
  assert.throws(
    () => verifyPublicationSubmission(value, policy, { now: NOW }),
    /authorization protocol is unsupported/,
  );
});

test("identifies an authorization replayed for a different intent", () => {
  const { submission: value, policy } = submission();
  value.authorization.payload.intentSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => verifyPublicationSubmission(value, policy, { now: NOW }),
    /authorization does not bind the submitted intent/,
  );
});
