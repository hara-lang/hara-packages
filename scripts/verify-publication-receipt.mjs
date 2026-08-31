#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RECEIPT_PATH = /^requests\/([a-z0-9][a-z0-9._-]*)\/([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\.json$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function relativePath(value, label) {
  const path = text(value, label);
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`${label} must be a repository-relative path`);
  }
  return path;
}

export function receiptPath(root, file) {
  const path = relative(root, resolve(file)).split(sep).join("/");
  const match = RECEIPT_PATH.exec(path);
  if (match === null) fail("receipt must live at requests/OWNER.REPO/VERSION.json");
  return { path, image: match[1], version: match[2] };
}

export function verifyReceipt(receipt, sourcePolicy, location) {
  const value = object(receipt, "receipt");
  if (value.format !== "hara-package-receipt/1") fail("receipt format must be hara-package-receipt/1");
  const { image, version } = location;
  const source = object(value.source, "receipt source");
  const repository = text(source.repository, "receipt source repository");
  const policy = object(sourcePolicy?.sources?.[repository], `source policy for ${repository}`);
  if (image !== repository.replace("/", ".")) fail("receipt path image must match source repository");
  if (text(source.coordinate, "receipt coordinate") !== text(policy.coordinate, "source policy coordinate")) fail("receipt coordinate is not authorized for source repository");
  if (text(source.projectPath, "receipt project path") !== text(policy.projectPath, "source policy project path")) fail("receipt project path is not authorized");
  if (text(source.tag, "receipt source tag") !== version || text(source.version, "receipt version") !== version) fail("receipt version and source tag must match its path");
  if (!COMMIT.test(text(source.commit, "receipt source commit"))) fail("receipt source commit must be a lowercase SHA-1");
  if (!SHA256.test(text(source.projectSha256, "receipt project SHA-256"))) fail("receipt project SHA-256 must be a lowercase SHA-256 digest");
  const recipePath = relativePath(source.recipePath, "receipt recipe path");
  if (!SHA256.test(text(source.recipeSha256, "receipt recipe SHA-256"))) fail("receipt recipe SHA-256 must be a lowercase SHA-256 digest");
  const native = object(source.native, "receipt native host");
  if (text(native.repository, "receipt native repository") !== text(policy.nativeRepository, "source policy native repository")) fail("receipt native host is not authorized");
  const nativeVersion = text(native.version, "receipt native version");
  if (!SEMVER.test(nativeVersion)) fail("receipt native version must be SemVer");
  const nativeTagPrefix = text(policy.nativeTagPrefix, "source policy native tag prefix");
  const nativeTag = text(native.tag, "receipt native tag");
  if (nativeTag !== `${nativeTagPrefix}${nativeVersion}`) fail("receipt native tag must identify its exact native version");
  if (!COMMIT.test(text(native.revision, "receipt native revision"))) fail("receipt native revision must be a lowercase SHA-1");
  const specs = object(value.specs, "receipt specs");
  if (text(specs.path, "receipt specs path") !== text(policy.specPath, "source policy spec path")) fail("receipt specs path is not authorized");
  if (specs.gitTree !== "absent" && !COMMIT.test(text(specs.gitTree, "receipt specs Git tree"))) fail("receipt specs Git tree must be absent or a lowercase SHA-1");
  const signature = object(value.signature, "receipt signature");
  const bundle = relativePath(signature.bundle, "receipt signature bundle");
  if (bundle !== `requests/${image}/${version}.sigstore.json`) fail("receipt signature bundle must be adjacent to receipt");
  return {
    repository,
    image,
    version,
    coordinate: source.coordinate,
    tag: source.tag,
    commit: source.commit,
    projectPath: source.projectPath,
    projectSha256: source.projectSha256,
    recipePath,
    recipeSha256: source.recipeSha256,
    nativeRepository: native.repository,
    nativeVersion,
    nativeTag,
    nativeRevision: native.revision,
    specsPath: specs.path,
    specsGitTree: specs.gitTree,
    bundle,
    requestWorkflow: text(policy.requestWorkflow, "source policy request workflow"),
  };
}

export async function readReceipt(file, { root = ROOT, policyPath = resolve(root, "publication-sources.json") } = {}) {
  const [source, policySource] = await Promise.all([readFile(file, "utf8"), readFile(policyPath, "utf8")]);
  let receipt;
  let policy;
  try {
    receipt = JSON.parse(source);
    policy = JSON.parse(policySource);
  } catch {
    fail("receipt and publication source policy must be JSON");
  }
  if (policy.format !== "hara-package-sources/1") fail("publication source policy format is invalid");
  return verifyReceipt(receipt, policy, receiptPath(root, file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    console.error("usage: verify-publication-receipt RECEIPT.json");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await readReceipt(file)));
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
  }
}
