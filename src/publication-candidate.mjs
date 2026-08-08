import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parseShowcaseManifest } from "./showcase.mjs";
import { preflightShowcase } from "./showcase-preflight.mjs";

export const PUBLICATION_CANDIDATE_FORMAT = 1;

const MAX_SHOWCASE_BYTES = 1_000_000;

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

export function stableJson(value, space = 0) {
  return JSON.stringify(sorted(value), null, space);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourcePath(source, path) {
  return source.root ? posix.join(source.root, path) : path;
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function rawPublicationSourceUrl(source, path, origin = "https://raw.githubusercontent.com") {
  const [owner, repository] = source.repository.split("/");
  return `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${source.commit}/${encodedPath(path)}`;
}

async function fetchShowcaseSource(request, {
  fetchImpl,
  rawOrigin,
} = {}) {
  const fullPath = sourcePath(request.source, request.showcase.path);
  const url = rawPublicationSourceUrl(request.source, fullPath, rawOrigin);
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "text/plain" } });
  } catch (error) {
    throw new Error(`Publication Showcase request failed: ${url}: ${error?.message || String(error)}`);
  }
  if (!response?.ok) {
    throw new Error(`Publication Showcase request failed (${response?.status ?? "unknown"}): ${url}`);
  }
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SHOWCASE_BYTES) {
    throw new Error(`Publication Showcase exceeds the ${MAX_SHOWCASE_BYTES}-byte limit: ${fullPath}`);
  }
  const source = await response.text();
  if (Buffer.byteLength(source) > MAX_SHOWCASE_BYTES) {
    throw new Error(`Publication Showcase exceeds the ${MAX_SHOWCASE_BYTES}-byte limit: ${fullPath}`);
  }
  return { source, path: fullPath, url };
}

function releaseTarget(packageId, version) {
  const [owner, name] = packageId.split("/");
  return `packages/${owner}/${name}/${version}.edn`;
}

function showcaseTarget(packageId, version) {
  const [owner, name] = packageId.split("/");
  return `packages/${owner}/${name}/${version}.showcase.edn`;
}

function releaseCandidateRecord(request) {
  return {
    "hara/type": ":package-release-candidate",
    "candidate/format": PUBLICATION_CANDIDATE_FORMAT,
    "package/name": request.package.name,
    "package/version": request.package.version,
    "package/namespaces": request.package.namespaces,
    "package/archive": request.artifact.archive,
    "package/archive-signature": request.artifact.signature,
    "publisher/key-id": request.publisher.keyId,
    "publisher/signature-algorithm": `:${request.publisher.signatureAlgorithm}`,
    "source/repository": request.source.repository,
    ...(request.source.branch ? { "source/branch": request.source.branch } : {}),
    "source/commit": request.source.commit,
    ...(request.source.tag ? { "source/tag": request.source.tag } : {}),
    ...(request.source.workflowRun ? { "source/workflow-run": request.source.workflowRun } : {}),
    "repro/build-command": request.reproducibility.buildCommand,
    "repro/toolchain": request.reproducibility.toolchain,
    "repro/artifact-sha256": request.artifact.sha256,
    "registry/intent": request.intent,
    "registry/request": request.requestPath,
    "registry/status": ":candidate",
  };
}

function assertShowcaseIdentity(request, showcase) {
  if (showcase.source.repository !== request.source.repository) {
    throw new Error(
      `Publication Showcase source ${showcase.source.repository} does not match request source ${request.source.repository}`,
    );
  }
  if (showcase.source.commit !== request.source.commit) {
    throw new Error(
      `Publication Showcase commit ${showcase.source.commit} does not match request commit ${request.source.commit}`,
    );
  }
  if (request.source.branch && showcase.source.branch && showcase.source.branch !== request.source.branch) {
    throw new Error(
      `Publication Showcase branch ${showcase.source.branch} does not match request branch ${request.source.branch}`,
    );
  }
}

export async function preparePublicationCandidate(request, {
  fetchImpl = globalThis.fetch,
  tokenValue = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  apiOrigin = "https://api.github.com",
  rawOrigin = "https://raw.githubusercontent.com",
  preflight = preflightShowcase,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Publication candidate preparation requires fetch");
  const packageId = request.package.name;
  const version = request.package.version;
  const requestDigest = sha256(stableJson(request));
  const release = {
    target: releaseTarget(packageId, version),
    record: releaseCandidateRecord(request),
  };

  let showcase = null;
  if (request.showcase) {
    const fetched = await fetchShowcaseSource(request, { fetchImpl, rawOrigin });
    const manifest = parseShowcaseManifest(fetched.source, {
      expectedPackage: packageId,
      expectedVersion: version,
    });
    assertShowcaseIdentity(request, manifest);
    const evidence = await preflight(manifest, {
      fetchImpl,
      tokenValue,
      apiOrigin,
      rawOrigin,
    });
    showcase = {
      target: showcaseTarget(packageId, version),
      requestPath: request.showcase.path,
      sourcePath: fetched.path,
      sourceSha256: sha256(fetched.source),
      manifest,
      evidence,
    };
  }

  const candidate = {
    format: PUBLICATION_CANDIDATE_FORMAT,
    request: request.requestPath,
    requestSha256: requestDigest,
    package: packageId,
    version,
    release,
    ...(showcase ? { showcase } : {}),
    authorities: {
      unverified: [
        "artifact/rebuild",
        "artifact/checksum",
        "publisher/archive-signature",
        "publisher/intent-signature",
        "publisher/namespace-grant",
      ],
      missing: [
        "registry/attestation",
        "source/release-upload",
        "registry/finalized-record",
      ],
    },
    status: "candidate",
  };
  return {
    ...candidate,
    candidateSha256: sha256(stableJson(candidate)),
  };
}
