import { posix } from "node:path";
import { EdnKeyword, readEdnData } from "./edn.mjs";

export const SHOWCASE_PREFLIGHT_FORMAT = 1;
export const FIXED_PLAYGROUND_SURFACES = Object.freeze([
  "files",
  "code",
  "preview",
  "audio",
  "repl",
  "learn",
]);

const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_DATA_FILE_BYTES = 1_000_000;
const GITHUB_API_VERSION = "2022-11-28";

function token(value) {
  if (value instanceof EdnKeyword) return value.name;
  if (typeof value === "string") return value.trim().replace(/^:/, "");
  return "";
}

function sourcePath(source, path) {
  return source.root ? posix.join(source.root, path) : path;
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function rawContentUrl(source, path, rawOrigin) {
  const [owner, repository] = source.repository.split("/");
  return `${rawOrigin}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${source.commit}/${encodedPath(path)}`;
}

function apiHeaders(tokenValue) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
  if (tokenValue) headers.Authorization = `Bearer ${tokenValue}`;
  return headers;
}

async function fetchJson(url, { fetchImpl, tokenValue }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: apiHeaders(tokenValue) });
  } catch (error) {
    throw new Error(`Showcase source request failed: ${url}: ${error?.message || String(error)}`);
  }
  if (!response?.ok) {
    throw new Error(`Showcase source request failed (${response?.status ?? "unknown"}): ${url}`);
  }
  return response.json();
}

async function fetchText(url, { fetchImpl, maximum = MAX_DATA_FILE_BYTES }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "text/plain" } });
  } catch (error) {
    throw new Error(`Showcase source request failed: ${url}: ${error?.message || String(error)}`);
  }
  if (!response?.ok) {
    throw new Error(`Showcase source request failed (${response?.status ?? "unknown"}): ${url}`);
  }
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    throw new Error(`Showcase source file exceeds the ${maximum}-byte preflight limit: ${url}`);
  }
  const source = await response.text();
  if (Buffer.byteLength(source) > maximum) {
    throw new Error(`Showcase source file exceeds the ${maximum}-byte preflight limit: ${url}`);
  }
  return source;
}

function requiredPathMap(showcase) {
  const required = new Map();
  const add = (path, type, use) => {
    if (!path) return;
    const fullPath = sourcePath(showcase.source, path);
    const current = required.get(fullPath) || { path: fullPath, type, uses: [] };
    if (current.type !== type) {
      throw new Error(`Showcase source path is required as both ${current.type} and ${type}: ${fullPath}`);
    }
    if (!current.uses.includes(use)) current.uses.push(use);
    required.set(fullPath, current);
  };

  for (const view of showcase.views) {
    add(view.source, "blob", `view:${view.id}:source`);
    add(view.docs, "blob", `view:${view.id}:docs`);
  }
  for (const state of showcase.states) {
    if (state.file && !state.file.endsWith(".edn")) {
      throw new Error(`Showcase state file must use the .edn extension: ${state.id}: ${state.file}`);
    }
    add(state.file, "blob", `state:${state.id}`);
  }
  for (const demo of showcase.demos) {
    const project = sourcePath(showcase.source, demo.project);
    add(demo.project, "tree", `demo:${demo.id}:project`);
    add(posix.join(demo.project, "project.edn"), "blob", `demo:${demo.id}:project-descriptor`);
    add(posix.join(demo.project, "workspace.edn"), "blob", `demo:${demo.id}:workspace`);
    add(demo.docs, "blob", `demo:${demo.id}:docs`);
    if (project === showcase.source.root) {
      throw new Error(`Showcase demo project must be below the source root: ${demo.id}`);
    }
  }
  return required;
}

function treeEntries(tree) {
  if (tree?.truncated) throw new Error("Showcase source tree is truncated; publication preflight cannot prove all paths");
  if (!Array.isArray(tree?.tree)) throw new Error("Showcase source tree response is malformed");
  return new Map(tree.tree.map((entry) => [entry.path, entry]));
}

function requireTreeEntries(showcase, tree) {
  const entries = treeEntries(tree);
  const required = requiredPathMap(showcase);
  for (const requirement of required.values()) {
    const entry = entries.get(requirement.path);
    if (!entry) {
      throw new Error(`Showcase source path is missing at ${showcase.source.commit}: ${requirement.path} (${requirement.uses.join(", ")})`);
    }
    if (entry.type !== requirement.type) {
      throw new Error(`Showcase source path must be a ${requirement.type}: ${requirement.path}`);
    }
    if (entry.type === "blob" && Number(entry.size) > MAX_DATA_FILE_BYTES
        && requirement.uses.some((use) => use.includes(":workspace") || use.startsWith("state:"))) {
      throw new Error(`Showcase data file exceeds the ${MAX_DATA_FILE_BYTES}-byte preflight limit: ${requirement.path}`);
    }
  }
  return { entries, required };
}

function workspaceSurfaces(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new Error("Showcase workspace.edn must evaluate to a map");
  }
  if (token(workspace["hara/type"]) !== "workspace") {
    throw new Error("Showcase workspace.edn must declare :hara/type :workspace");
  }
  const surfaces = new Set(FIXED_PLAYGROUND_SURFACES);
  const add = (value) => {
    const id = token(value);
    if (id) surfaces.add(id);
  };

  const selection = workspace["workspace/selection"];
  if (selection && typeof selection === "object") add(selection["surface/id"]);
  const customizations = workspace["workspace/customizations"];
  if (customizations && typeof customizations === "object") {
    add(customizations["responsive/default-surface"]);
    const declared = customizations["responsive/surfaces"];
    if (Array.isArray(declared)) {
      for (const surface of declared) if (surface && typeof surface === "object") add(surface["surface/id"]);
    }
  }
  const areas = workspace["workspace/areas"];
  if (Array.isArray(areas)) {
    for (const area of areas) {
      const presentation = area?.["area/presentation"];
      if (presentation && typeof presentation === "object") add(presentation["presentation/surface"]);
    }
  }
  return [...surfaces].sort();
}

function cacheKey(source) {
  return `${source.repository}@${source.commit}`;
}

async function sourceTree(source, options, cache) {
  const key = cacheKey(source);
  if (cache.trees.has(key)) return cache.trees.get(key);
  const url = `${options.apiOrigin}/repos/${source.repository.split("/").map(encodeURIComponent).join("/")}/git/trees/${source.commit}?recursive=1`;
  const tree = await fetchJson(url, options);
  const value = { ...tree, requestUrl: url };
  cache.trees.set(key, value);
  return value;
}

async function sourceText(source, path, options, cache) {
  const fullPath = sourcePath(source, path);
  const key = `${cacheKey(source)}:${fullPath}`;
  if (cache.text.has(key)) return cache.text.get(key);
  const url = rawContentUrl(source, fullPath, options.rawOrigin);
  const value = await fetchText(url, options);
  cache.text.set(key, value);
  return value;
}

function validateSourceIdentity(source) {
  if (!source || typeof source !== "object") throw new Error("Showcase source is missing");
  if (!REPOSITORY.test(source.repository || "")) throw new Error("Showcase source repository is invalid");
  if (!COMMIT.test(source.commit || "")) throw new Error("Showcase source commit must be an immutable lowercase SHA");
}

export async function preflightShowcase(showcase, {
  fetchImpl = globalThis.fetch,
  tokenValue = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  apiOrigin = "https://api.github.com",
  rawOrigin = "https://raw.githubusercontent.com",
  workspaceReader = readEdnData,
  stateReader = readEdnData,
  cache = { trees: new Map(), text: new Map() },
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Showcase publication preflight requires fetch");
  validateSourceIdentity(showcase?.source);
  const options = { fetchImpl, tokenValue, apiOrigin, rawOrigin };
  const tree = await sourceTree(showcase.source, options, cache);
  const { required } = requireTreeEntries(showcase, tree);

  const projects = [];
  const projectSurfaces = new Map();
  for (const demo of showcase.demos) {
    if (!projectSurfaces.has(demo.project)) {
      const workspacePath = posix.join(demo.project, "workspace.edn");
      const workspaceSource = await sourceText(showcase.source, workspacePath, options, cache);
      let workspace;
      try {
        workspace = workspaceReader(workspaceSource);
      } catch (error) {
        throw new Error(`Showcase workspace is not valid data: ${sourcePath(showcase.source, workspacePath)}: ${error?.message || String(error)}`);
      }
      const surfaces = workspaceSurfaces(workspace);
      projectSurfaces.set(demo.project, surfaces);
      projects.push({
        path: sourcePath(showcase.source, demo.project),
        projectDescriptor: sourcePath(showcase.source, posix.join(demo.project, "project.edn")),
        workspace: sourcePath(showcase.source, workspacePath),
        surfaces,
      });
    }
    const surfaces = projectSurfaces.get(demo.project);
    if (!surfaces.includes(demo.surface)) {
      throw new Error(`Showcase demo ${demo.id} selects undeclared surface ${demo.surface} in ${demo.project}/workspace.edn`);
    }
  }

  const states = [];
  for (const state of showcase.states) {
    if (!state.file) continue;
    const stateSource = await sourceText(showcase.source, state.file, options, cache);
    try {
      stateReader(stateSource);
    } catch (error) {
      throw new Error(`Showcase state file is not valid data: ${sourcePath(showcase.source, state.file)}: ${error?.message || String(error)}`);
    }
    states.push({ id: state.id, path: sourcePath(showcase.source, state.file) });
  }

  return {
    format: SHOWCASE_PREFLIGHT_FORMAT,
    package: showcase.package,
    version: showcase.version,
    source: {
      repository: showcase.source.repository,
      commit: showcase.source.commit,
      tree: typeof tree.sha === "string" ? tree.sha : null,
    },
    paths: [...required.values()]
      .map((entry) => ({ ...entry, uses: [...entry.uses].sort() }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    projects: projects.sort((left, right) => left.path.localeCompare(right.path)),
    states: states.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function preflightGalleryIndex(index, options = {}) {
  const cache = options.cache || { trees: new Map(), text: new Map() };
  const packages = [];
  for (const packageRecord of index?.packages || []) {
    const versions = [];
    for (const showcase of packageRecord.versions || []) {
      versions.push(await preflightShowcase(showcase, { ...options, cache }));
    }
    packages.push({ id: packageRecord.id, versions });
  }
  return {
    format: SHOWCASE_PREFLIGHT_FORMAT,
    registry: index?.registry || "hara",
    packages,
    sources: cache.trees.size,
  };
}
