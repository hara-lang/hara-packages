import { EdnKeyword, readEdnData } from "./edn.mjs";
import { normalizeRegistryPath } from "./showcase.mjs";

export const PUBLICATION_REQUEST_FORMAT = 1;
export const PUBLICATION_REQUEST_SUFFIX = ".edn";

const PACKAGE_ID = /^[a-z][a-z0-9.-]{0,62}\/[a-z][a-z0-9._-]{0,62}$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NAMESPACE = /^[A-Za-z][A-Za-z0-9_.-]{0,126}$/;
const REQUEST_PATH = /^requests\/([^/]+)\/([^/]+)\/([^/]+)\.edn$/;

const LIMITS = Object.freeze({
  text: 16_000,
  command: 2_000,
  namespaces: 128,
  toolchain: 64,
});

const TOP_KEYS = new Set([
  "hara/type",
  "request/format",
  "request/package",
  "request/source",
  "request/artifact",
  "request/publisher",
  "request/reproducibility",
  "request/intent",
  "request/showcase",
]);
const PACKAGE_KEYS = new Set(["package/name", "package/version", "package/namespaces"]);
const SOURCE_KEYS = new Set([
  "source/repository",
  "source/branch",
  "source/commit",
  "source/tag",
  "source/workflow-run",
  "source/root",
]);
const ARTIFACT_KEYS = new Set(["artifact/archive", "artifact/sha256", "artifact/signature"]);
const PUBLISHER_KEYS = new Set(["publisher/key-id", "publisher/signature-algorithm"]);
const REPRO_KEYS = new Set(["repro/build-command", "repro/toolchain"]);
const SHOWCASE_KEYS = new Set(["showcase/path"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof EdnKeyword) {
    throw new TypeError(`${label} must be a map`);
  }
  return value;
}

function knownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field :${key}`);
  }
}

function token(value, label, { optional = false } = {}) {
  if (value == null && optional) return null;
  const output = value instanceof EdnKeyword
    ? value.name
    : typeof value === "string"
      ? value.trim().replace(/^:/, "")
      : "";
  if (!output) throw new TypeError(`${label} must be a keyword or non-empty string`);
  return output;
}

function text(value, label, { optional = false, maximum = LIMITS.text } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  const output = value.trim();
  if (output.length > maximum) throw new RangeError(`${label} exceeds the ${maximum}-character limit`);
  return output;
}

function positiveInteger(value, label, { optional = false } = {}) {
  if (value == null && optional) return null;
  const output = Number(value);
  if (!Number.isSafeInteger(output) || output <= 0) throw new TypeError(`${label} must be a positive integer`);
  return output;
}

function vector(value, label, maximum) {
  if (!Array.isArray(value) || !value.length) throw new TypeError(`${label} must be a non-empty vector`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds the ${maximum}-entry limit`);
  return value;
}

function normalizePackage(value) {
  const packageRecord = record(value, "Publication package");
  knownKeys(packageRecord, PACKAGE_KEYS, "Publication package");
  const name = token(packageRecord["package/name"], "Publication package name");
  if (!PACKAGE_ID.test(name)) throw new TypeError("Publication package name must use lowercase owner/name form");
  const version = text(packageRecord["package/version"], "Publication package version", { maximum: 100 });
  if (!VERSION.test(version)) throw new TypeError("Publication package version must be a semantic version");
  const namespaces = vector(
    packageRecord["package/namespaces"],
    "Publication package namespaces",
    LIMITS.namespaces,
  ).map((entry, index) => {
    const namespace = token(entry, `Publication namespace ${index}`);
    if (!NAMESPACE.test(namespace)) throw new TypeError(`Publication namespace ${index} is invalid: ${namespace}`);
    return namespace;
  });
  if (new Set(namespaces).size !== namespaces.length) throw new Error("Publication package namespaces must be unique");
  return { name, version, namespaces: [...namespaces].sort() };
}

function normalizeSource(value) {
  const source = record(value, "Publication source");
  knownKeys(source, SOURCE_KEYS, "Publication source");
  const repository = text(source["source/repository"], "Publication source repository", { maximum: 201 });
  if (!REPOSITORY.test(repository) || repository.endsWith(".git")) {
    throw new TypeError("Publication source repository must use GitHub owner/repository form");
  }
  const commit = text(source["source/commit"], "Publication source commit", { maximum: 40 });
  if (!COMMIT.test(commit)) throw new TypeError("Publication source commit must be a lowercase 40-character SHA");
  const branch = text(source["source/branch"], "Publication source branch", { optional: true, maximum: 200 });
  const tag = text(source["source/tag"], "Publication source tag", { optional: true, maximum: 200 });
  const workflowRun = positiveInteger(source["source/workflow-run"], "Publication workflow run", { optional: true });
  const root = normalizeRegistryPath(source["source/root"] ?? "", "Publication source root", { allowEmpty: true });
  return {
    repository,
    commit,
    ...(branch ? { branch } : {}),
    ...(tag ? { tag } : {}),
    ...(workflowRun ? { workflowRun } : {}),
    root,
  };
}

function normalizeArtifact(value) {
  const artifact = record(value, "Publication artifact");
  knownKeys(artifact, ARTIFACT_KEYS, "Publication artifact");
  const archive = text(artifact["artifact/archive"], "Publication archive", { maximum: 240 });
  if (archive.includes("/") || archive.includes("\\") || !archive.endsWith(".harp")) {
    throw new TypeError("Publication archive must be a .harp release asset filename");
  }
  const sha256 = text(artifact["artifact/sha256"], "Publication archive SHA-256", { maximum: 64 });
  if (!SHA256.test(sha256)) throw new TypeError("Publication archive SHA-256 must be 64 lowercase hexadecimal characters");
  const signature = text(artifact["artifact/signature"], "Publication archive signature");
  return { archive, sha256, signature };
}

function normalizePublisher(value) {
  const publisher = record(value, "Publication publisher");
  knownKeys(publisher, PUBLISHER_KEYS, "Publication publisher");
  const keyId = text(publisher["publisher/key-id"], "Publisher key id", { maximum: 512 });
  const signatureAlgorithm = token(
    publisher["publisher/signature-algorithm"],
    "Publisher signature algorithm",
  );
  if (signatureAlgorithm !== "ed25519") throw new Error("Publisher signature algorithm must be :ed25519");
  return { keyId, signatureAlgorithm };
}

function normalizeReproducibility(value) {
  const reproducibility = record(value, "Publication reproducibility");
  knownKeys(reproducibility, REPRO_KEYS, "Publication reproducibility");
  const buildCommand = text(
    reproducibility["repro/build-command"],
    "Publication build command",
    { maximum: LIMITS.command },
  );
  const toolchain = vector(
    reproducibility["repro/toolchain"],
    "Publication toolchain",
    LIMITS.toolchain,
  ).map((entry, index) => text(entry, `Publication toolchain entry ${index}`, { maximum: 240 }));
  if (new Set(toolchain).size !== toolchain.length) throw new Error("Publication toolchain entries must be unique");
  return { buildCommand, toolchain: [...toolchain].sort() };
}

function normalizeShowcase(value) {
  if (value == null) return null;
  const showcase = record(value, "Publication Showcase");
  knownKeys(showcase, SHOWCASE_KEYS, "Publication Showcase");
  const path = normalizeRegistryPath(showcase["showcase/path"], "Publication Showcase path");
  if (!path.endsWith(".edn")) throw new TypeError("Publication Showcase path must use the .edn extension");
  return { path };
}

export function publicationRequestPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const match = REQUEST_PATH.exec(normalized);
  if (!match) throw new Error(`Publication request path must use requests/<owner>/<name>/<version>.edn: ${path}`);
  return {
    path: normalized,
    package: `${match[1]}/${match[2]}`,
    version: match[3],
  };
}

export function normalizePublicationRequest(value, {
  expectedPackage = null,
  expectedVersion = null,
  requestPath = null,
} = {}) {
  const request = record(value, "Publication request");
  knownKeys(request, TOP_KEYS, "Publication request");
  const type = token(request["hara/type"], "Publication request :hara/type");
  if (type !== "package-publication-request") {
    throw new Error(`Expected :hara/type :package-publication-request, received :${type}`);
  }
  const format = Number(request["request/format"]);
  if (format !== PUBLICATION_REQUEST_FORMAT) throw new Error(`Unsupported publication request format: ${request["request/format"]}`);
  const packageRecord = normalizePackage(request["request/package"]);
  if (expectedPackage && packageRecord.name !== expectedPackage) {
    throw new Error(`Publication package ${packageRecord.name} does not match request path ${expectedPackage}`);
  }
  if (expectedVersion && packageRecord.version !== expectedVersion) {
    throw new Error(`Publication version ${packageRecord.version} does not match request path ${expectedVersion}`);
  }
  const source = normalizeSource(request["request/source"]);
  const artifact = normalizeArtifact(request["request/artifact"]);
  const publisher = normalizePublisher(request["request/publisher"]);
  const reproducibility = normalizeReproducibility(request["request/reproducibility"]);
  const intent = text(request["request/intent"], "Publication intent");
  const showcase = normalizeShowcase(request["request/showcase"]);
  return {
    format,
    ...(requestPath ? { requestPath } : {}),
    package: packageRecord,
    source,
    artifact,
    publisher,
    reproducibility,
    intent,
    ...(showcase ? { showcase } : {}),
  };
}

export function parsePublicationRequest(source, options = {}) {
  return normalizePublicationRequest(readEdnData(source), options);
}
