import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalAuthorization } from "../src/publication-submission.mjs";
import { createMemoryReplayStore, handle } from "../netlify/functions/publication.mjs";

const NOW = 1_700_000_000_000;
const REVISION = "a".repeat(40);

function rawKey(key) {
  return key.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
}

function requestFixture() {
  const publisher = generateKeyPairSync("ed25519");
  const authorization = generateKeyPairSync("ed25519");
  const intent = `{:intent/format "0.0.0-alpha" :tap "hara" :coordinate "hara:hara-native/smoke-answer" :version "0.1.0" :repository "git@github.com:hara-lang/hara-native.git" :tag "0.1.0" :commit "${"b".repeat(40)}" :project-sha256 "sha256:${"c".repeat(64)}" :recipe-sha256 "sha256:${"d".repeat(64)}" :identity-revision "${REVISION}"}\n`;
  const payload = {
    authorization: "hara-publisher/1",
    keyId: "hoebat-2026-01",
    githubSubject: "1455572",
    coordinate: "hara:hara-native/smoke-answer",
    intentSha256: `sha256:${createHash("sha256").update(intent).digest("hex")}`,
    identityRevision: REVISION,
    nonce: "p".repeat(32),
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
  return {
    body: {
      intent,
      key_id: payload.keyId,
      signature: sign(null, Buffer.from(intent), publisher.privateKey).toString("hex"),
      authorization: { payload, signature: sign(null, Buffer.from(canonicalAuthorization(payload)), authorization.privateKey).toString("hex") },
    },
    policy: {
      revision: REVISION,
      authorizationPublicKey: rawKey(authorization.publicKey),
      publisherKeys: {
        "hoebat-2026-01": { publicKey: rawKey(publisher.publicKey), githubSubject: "1455572", coordinates: ["hara:hara-native/smoke-answer"], namespaceOwners: [], revoked: false },
      },
    },
  };
}

test("publication intake creates one review request and rejects authorization replay", async () => {
  const { body, policy } = requestFixture();
  const store = createMemoryReplayStore();
  const input = () => new Request("https://packages.hara-lang.org/v1/publications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const createRequest = async (verified) => {
    assert.equal(verified.intent.tag, "0.1.0");
    return { url: "https://github.com/hara-lang/hara-packages/pull/99", number: 99, reused: false };
  };
  const first = await handle(input(), { policy, store, createRequest, now: NOW });
  assert.equal(first.status, 202, await first.clone().text());
  assert.deepEqual(await first.json(), {
    status: "request-created",
    coordinate: "hara:hara-native/smoke-answer",
    version: "0.1.0",
    request: { url: "https://github.com/hara-lang/hara-packages/pull/99", number: 99, reused: false },
  });
  const replay = await handle(input(), { policy, store, createRequest, now: NOW });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, "AUTHORIZATION_REPLAYED");
});
