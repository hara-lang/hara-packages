import { createHash } from "node:crypto";

export const GHCR_ORIGIN = "https://ghcr.io";
export const PACKAGES_ORGANIZATION = "hara-packages";
export const HARP_LAYER_MEDIA_TYPE = "application/vnd.hara.harp.v1+zip";
export const SOURCE_KIND = "source";
export const SPECS_KIND = "specs";

const DIGEST = /^sha256:([0-9a-f]{64})$/;
const REVISION = /^[0-9a-f]{40}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "hara-packages-service",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function packageToken(env) {
  const value = env?.HARA_GITHUB_PACKAGES_READ_TOKEN;
  return typeof value === "string" ? value.trim() : "";
}

function packageApiUrl(path) {
  return `https://api.github.com${path}`;
}

function ghcrTokenUrl(repository) {
  const url = new URL("/token", GHCR_ORIGIN);
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${repository}:pull`);
  return url.toString();
}

function manifestUrl(repository, tag) {
  return `${GHCR_ORIGIN}/v2/${repository}/manifests/${encodeURIComponent(tag)}`;
}

function blobUrl(repository, digest) {
  return `${GHCR_ORIGIN}/v2/${repository}/blobs/${digest}`;
}

export function imageRepository(name) {
  if (!PACKAGE_NAME.test(name)) throw new TypeError("package name is invalid");
  return `${PACKAGES_ORGANIZATION}/${name}`;
}

async function githubJson(path, { env, fetchImpl }) {
  const response = await fetchImpl(packageApiUrl(path), {
    headers: githubHeaders(packageToken(env)),
  });
  if (!response.ok) throw new Error(`GitHub Packages API request failed (${response.status})`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error("GitHub Packages API response must be an array");
  return value;
}

async function pagedGithubJson(path, context) {
  const values = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const pageValues = await githubJson(`${path}${separator}per_page=100&page=${page}`, context);
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
  throw new Error("GitHub Packages API pagination limit exceeded");
}

async function ghcrFetch(url, repository, init, fetchImpl) {
  const response = await fetchImpl(url, init);
  if (response.status !== 401 || !/^Bearer\b/i.test(response.headers.get("www-authenticate") ?? "")) {
    return response;
  }
  const tokenResponse = await fetchImpl(ghcrTokenUrl(repository));
  if (!tokenResponse.ok) return response;
  const token = (await tokenResponse.json().catch(() => null))?.token;
  if (typeof token !== "string" || token.length === 0) return response;
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetchImpl(url, { ...init, headers });
}

function archiveLayer(manifest) {
  const layers = Array.isArray(manifest?.layers)
    ? manifest.layers.filter((layer) => layer?.mediaType === HARP_LAYER_MEDIA_TYPE)
    : [];
  if (layers.length !== 1) throw new Error("OCI manifest must have exactly one HARP layer");
  const [layer] = layers;
  if (!DIGEST.test(layer.digest ?? "") || !Number.isInteger(layer.size) || layer.size < 0 || layer.size > MAX_ARCHIVE_BYTES) {
    throw new Error("OCI HARP layer is invalid");
  }
  return layer;
}

function annotation(manifest, key) {
  const value = manifest?.annotations?.[key];
  return typeof value === "string" ? value : "";
}

async function readManifest(repository, tag, { fetchImpl }) {
  const response = await ghcrFetch(
    manifestUrl(repository, tag),
    repository,
    { headers: { accept: "application/vnd.oci.image.manifest.v1+json" } },
    fetchImpl,
  );
  const manifestDigest = response.headers.get("docker-content-digest");
  if (!response.ok || !DIGEST.test(manifestDigest ?? "")) {
    throw new Error(`OCI manifest ${repository}:${tag} is unavailable`);
  }
  const manifest = await response.json().catch(() => null);
  if (manifest?.schemaVersion !== 2) throw new Error("OCI manifest schema is invalid");
  return { manifest, manifestDigest };
}

function descriptor({ name, tag, repository, manifest, manifestDigest, kind }) {
  const source = annotation(manifest, "org.opencontainers.image.source");
  const revision = annotation(manifest, "org.opencontainers.image.revision");
  const coordinate = annotation(manifest, "io.hara.package.coordinate");
  const sourceCoordinate = annotation(manifest, "io.hara.package.source-coordinate") || coordinate;
  const actualKind = annotation(manifest, "io.hara.package.kind");
  if (!source.startsWith("https://github.com/") || !REVISION.test(revision) || !coordinate || actualKind !== kind) {
    throw new Error(`OCI manifest ${repository}:${tag} has invalid Hara provenance`);
  }
  const layer = archiveLayer(manifest);
  return {
    name,
    tag,
    repository: `ghcr.io/${repository}`,
    manifest: manifestDigest,
    archive: layer.digest,
    size: layer.size,
    coordinate,
    sourceCoordinate,
    source,
    revision,
    kind,
  };
}

async function imageVersions(name, context) {
  const versions = await pagedGithubJson(
    `/orgs/${PACKAGES_ORGANIZATION}/packages/container/${encodeURIComponent(name)}/versions`,
    context,
  );
  const tags = new Set();
  for (const version of versions) {
    for (const tag of version?.metadata?.container?.tags ?? []) {
      if (typeof tag === "string" && SEMVER.test(tag)) tags.add(tag);
    }
  }
  return [...tags].sort();
}

async function listPackageNames(context) {
  const packages = await pagedGithubJson(
    `/orgs/${PACKAGES_ORGANIZATION}/packages?package_type=container`,
    context,
  );
  return packages
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && PACKAGE_NAME.test(name))
    .sort();
}

export async function resolveCatalog({ env = process.env, fetchImpl = fetch } = {}) {
  const context = { env, fetchImpl };
  const names = await listPackageNames(context);
  const sources = names.filter((name) => !name.endsWith(".specs"));
  const entries = [];
  for (const name of sources) {
    const repository = imageRepository(name);
    const specsName = `${name}.specs`;
    const tags = await imageVersions(name, context);
    const specTags = names.includes(specsName) ? new Set(await imageVersions(specsName, context)) : new Set();
    for (const tag of tags) {
      if (!specTags.has(tag)) continue;
      const source = descriptor({
        name,
        tag,
        repository,
        ...await readManifest(repository, tag, context),
        kind: SOURCE_KIND,
      });
      const specsRepository = imageRepository(specsName);
      const specs = descriptor({
        name: specsName,
        tag,
        repository: specsRepository,
        ...await readManifest(specsRepository, tag, context),
        kind: SPECS_KIND,
      });
      if (source.coordinate !== specs.sourceCoordinate || source.source !== specs.source || source.revision !== specs.revision) {
        throw new Error(`OCI source/specs pair ${name}:${tag} does not share provenance`);
      }
      entries.push({ source, specs });
    }
  }
  entries.sort((left, right) => left.source.coordinate.localeCompare(right.source.coordinate)
    || left.source.tag.localeCompare(right.source.tag));
  return entries;
}

export async function fetchArchive(entry, { fetchImpl = fetch } = {}) {
  const repository = entry.repository.replace(/^ghcr\.io\//, "");
  const response = await ghcrFetch(blobUrl(repository, entry.archive), repository, {}, fetchImpl);
  if (!response.ok) throw new Error(`OCI archive ${entry.repository}@${entry.archive} is unavailable`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.archive) {
    throw new Error(`OCI archive ${entry.repository}@${entry.archive} failed digest verification`);
  }
  return bytes;
}

export function createCatalogCache({ now = () => Date.now(), ttl = 30_000, resolve = resolveCatalog } = {}) {
  let current = null;
  return {
    async read(options) {
      if (current === null || now() >= current.expiresAt) {
        current = { entries: await resolve(options), expiresAt: now() + ttl };
      }
      return current.entries;
    },
    reset() {
      current = null;
    },
  };
}
