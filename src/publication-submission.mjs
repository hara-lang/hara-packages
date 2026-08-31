import { createHash, createPublicKey, verify as verifyDetached } from "node:crypto";
import { readEdnData } from "./edn.mjs";

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const COORDINATE = /^hara:([a-z][a-z0-9.-]{0,62})\/([a-z][a-z0-9._-]{0,62})$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function exactKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
}

function text(value, label, pattern = null) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  const output = value.trim();
  if (pattern && !pattern.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function rawEd25519PublicKey(hex) {
  if (!HEX_32.test(hex)) throw new TypeError("Ed25519 public key must be 32-byte lowercase hexadecimal");
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function scopeMatches(key, coordinate) {
  return (key.coordinates ?? []).includes(coordinate)
    || (key.namespaceOwners ?? []).some((owner) => coordinate.startsWith(`hara:${owner}/`));
}

export function canonicalAuthorization(payload) {
  return JSON.stringify({
    authorization: "hara-publisher/1",
    keyId: payload.keyId,
    githubSubject: payload.githubSubject,
    coordinate: payload.coordinate,
    intentSha256: payload.intentSha256,
    identityRevision: payload.identityRevision,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
  });
}

export function parsePublicationIntent(source) {
  const intent = record(readEdnData(source), "Publication intent");
  exactKeys(intent, new Set([
    "intent/format", "tap", "coordinate", "version", "repository", "tag", "commit", "project-sha256", "recipe-sha256", "identity-revision",
  ]), "Publication intent");
  if (intent["intent/format"] !== "0.0.0-alpha") throw new TypeError("Publication intent format is unsupported");
  if (intent.tap !== "hara") throw new TypeError("Publication intent tap is unsupported");
  const coordinate = text(intent.coordinate, "Publication coordinate", COORDINATE);
  const version = text(intent.version, "Publication version", VERSION);
  const repository = text(intent.repository, "Publication repository");
  const tag = text(intent.tag, "Publication tag");
  const commit = text(intent.commit, "Publication commit", REVISION);
  const projectSha256 = text(intent["project-sha256"], "Publication project digest", SHA256);
  const recipeSha256 = text(intent["recipe-sha256"], "Publication recipe digest", SHA256);
  const identityRevision = text(intent["identity-revision"], "Publication identity revision", REVISION);
  const [, owner, name] = COORDINATE.exec(coordinate);
  return { coordinate, owner, name, version, repository, tag, commit, projectSha256, recipeSha256, identityRevision };
}

export function parsePublicationSubmission(value) {
  value = record(value, "Publication submission");
  exactKeys(value, new Set(["intent", "key_id", "signature", "authorization"]), "Publication submission");
  // Intent bytes are signed as supplied by the native client.  Unlike regular
  // display fields, they must never be trimmed or reserialized before the
  // publisher signature is verified.
  if (typeof value.intent !== "string" || !value.intent.trim()) throw new TypeError("Publication submission intent must be a non-empty string");
  const intent = value.intent;
  const keyId = text(value.key_id, "Publisher key id", KEY_ID);
  const signature = text(value.signature, "Publisher signature", HEX_64);
  const authorization = record(value.authorization, "Publication authorization");
  exactKeys(authorization, new Set(["payload", "signature"]), "Publication authorization");
  const payload = record(authorization.payload, "Publication authorization payload");
  const authorizationSignature = text(authorization.signature, "Publication authorization signature", HEX_64);
  return { intent, keyId, signature, authorization: { payload, signature: authorizationSignature } };
}

function verifyAuthorizationBinding(payload, { keyId, intent, source, publisher, policy, now }) {
  if (payload.authorization !== "hara-publisher/1") throw new Error("Publication authorization protocol is unsupported");
  if (payload.keyId !== keyId) throw new Error("Publication authorization key does not match the publisher signature");
  if (payload.coordinate !== intent.coordinate) throw new Error("Publication authorization coordinate does not match the package");
  if (payload.intentSha256 !== sha256(source)) throw new Error("Publication authorization does not bind the submitted intent");
  if (payload.identityRevision !== policy.revision) throw new Error("Publication authorization policy revision does not match the canonical intent");
  if (typeof payload.githubSubject !== "string" || !/^\d+$/.test(payload.githubSubject)) throw new Error("Publication authorization GitHub subject is invalid");
  if (publisher.githubSubject !== payload.githubSubject) throw new Error("Publication authorization GitHub subject is not authorized for this publisher key");
  if (typeof payload.nonce !== "string" || payload.nonce.length < 24) throw new Error("Publication authorization nonce is invalid");
  if (Date.parse(payload.expiresAt) <= now) throw new Error("Publication authorization has expired");
}

export function verifyPublicationSubmission(submission, policy, { now = Date.now() } = {}) {
  const parsed = parsePublicationSubmission(submission);
  const intent = parsePublicationIntent(parsed.intent);
  if (intent.identityRevision !== policy.revision) throw new Error("Publication identity policy revision does not match the canonical intent");
  const publisher = policy.publisherKeys?.[parsed.keyId];
  if (!publisher || publisher.revoked) throw new Error("Publisher key is not authorized by the signed identity policy");
  if (!scopeMatches(publisher, intent.coordinate)) throw new Error("Publisher key is not authorized for the package coordinate");
  if (!verifyDetached(null, Buffer.from(parsed.intent), rawEd25519PublicKey(publisher.publicKey), Buffer.from(parsed.signature, "hex"))) {
    throw new Error("Publisher intent signature is invalid");
  }
  const payload = parsed.authorization.payload;
  verifyAuthorizationBinding(payload, { keyId: parsed.keyId, intent, source: parsed.intent, publisher, policy, now });
  if (!HEX_32.test(policy.authorizationPublicKey ?? "")) throw new Error("Signed identity policy has no publication authorization key");
  if (!verifyDetached(null, Buffer.from(canonicalAuthorization(payload)), rawEd25519PublicKey(policy.authorizationPublicKey), Buffer.from(parsed.authorization.signature, "hex"))) {
    throw new Error("Publication authorization signature is invalid");
  }
  return { intent, keyId: parsed.keyId, githubSubject: payload.githubSubject, authorizationNonce: payload.nonce };
}

function rawPolicyPublicKey(value) {
  if (typeof value !== "string" || !HEX_32.test(value)) throw new Error("Signed identity policy root key is invalid");
  return value;
}

function normalizePublisherKeys(value) {
  return Object.fromEntries(Object.entries(record(value, "Identity publisher keys")).map(([id, entry]) => {
    entry = record(entry, `Publisher key ${id}`);
    return [id, {
      publicKey: text(entry["public-key"], `Publisher key ${id} public key`, HEX_32),
      githubSubject: text(entry["github-subject"], `Publisher key ${id} GitHub subject`, /^\d+$/),
      coordinates: Array.isArray(entry.coordinates) ? entry.coordinates.map((coordinate) => text(coordinate, `Publisher key ${id} coordinate`, COORDINATE)) : [],
      namespaceOwners: Array.isArray(entry["namespace-owners"]) ? entry["namespace-owners"].map((owner) => text(owner, `Publisher key ${id} namespace owner`, /^[a-z][a-z0-9.-]{0,62}$/)) : [],
      revoked: entry.revoked === true,
    }];
  }));
}

export async function loadSignedIdentityPolicy(revision, {
  identityEndpoint = "https://id.hara-lang.org",
  rootFingerprint,
  fetchImpl = fetch,
} = {}) {
  if (!REVISION.test(revision)) throw new TypeError("Identity revision must be a 40-character commit");
  if (!SHA256.test(rootFingerprint ?? "")) throw new TypeError("Official identity root fingerprint must be configured");
  const [document, signature] = await Promise.all([
    fetchImpl(`${identityEndpoint.replace(/\/$/, "")}/v1/identity?ref=${revision}`, { headers: { accept: "application/edn" } }),
    fetchImpl(`${identityEndpoint.replace(/\/$/, "")}/v1/identity-signature?ref=${revision}`, { headers: { accept: "text/plain" } }),
  ]);
  if (!document.ok || !signature.ok) throw new Error("Signed identity policy is unavailable");
  const body = await document.text();
  const signatureHex = (await signature.text()).trim();
  if (!HEX_64.test(signatureHex)) throw new Error("Signed identity policy signature is invalid");
  const decoded = record(readEdnData(body), "Identity policy");
  const rootKey = rawPolicyPublicKey(decoded["identity/root-key"]);
  if (sha256(Buffer.from(rootKey, "hex")) !== rootFingerprint) throw new Error("Signed identity policy root key does not match the pinned fingerprint");
  if (!verifyDetached(null, Buffer.from(body), rawEd25519PublicKey(rootKey), Buffer.from(signatureHex, "hex"))) throw new Error("Signed identity policy signature is invalid");
  return {
    revision,
    publisherKeys: normalizePublisherKeys(decoded["publisher-keys"]),
    authorizationPublicKey: decoded["identity/publish-authorization-key"],
  };
}
