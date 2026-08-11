import { EdnKeyword, readEdnData } from "./edn.mjs";

export const SHOWCASE_FORMAT = "0.0.0-alpha";
export const SHOWCASE_SIDECAR_SUFFIX = ".showcase.edn";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/;
const PACKAGE_ID = /^[a-z][a-z0-9.-]{0,62}\/[a-z][a-z0-9._-]{0,62}$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PATH_SEGMENT = /^[^\\/?#\u0000-\u001f]+$/;

const LIMITS = Object.freeze({
  views: 128,
  states: 256,
  demos: 512,
  tags: 16,
  text: 4_000,
  title: 160,
  stateDepth: 24,
  stateEntries: 10_000,
  stateString: 100_000,
});

const TOP_KEYS = new Set([
  "hara/type",
  "showcase/format",
  "showcase/package",
  "showcase/version",
  "showcase/title",
  "showcase/summary",
  "showcase/source",
  "showcase/views",
  "showcase/states",
  "showcase/demos",
]);
const SOURCE_KEYS = new Set([
  "source/repository",
  "source/commit",
  "source/branch",
  "source/root",
]);
const VIEW_KEYS = new Set([
  "view/id",
  "view/title",
  "view/summary",
  "view/source",
  "view/docs",
]);
const STATE_KEYS = new Set([
  "state/id",
  "state/title",
  "state/summary",
  "state/file",
  "state/value",
]);
const DEMO_KEYS = new Set([
  "demo/id",
  "demo/title",
  "demo/summary",
  "demo/view",
  "demo/state",
  "demo/project",
  "demo/surface",
  "demo/docs",
  "demo/tags",
  "demo/theme",
  "demo/viewport",
  "demo/default",
]);
const VIEWPORT_KEYS = new Set(["viewport/width", "viewport/height"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof EdnKeyword) {
    throw new TypeError(`${label} must be a map`);
  }
  return value;
}

function array(value, label, maximum) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a vector`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds the ${maximum}-entry limit`);
  return value;
}

function knownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field :${key}`);
  }
}

function token(value, label, { optional = false } = {}) {
  if (value == null && optional) return null;
  const output = value instanceof EdnKeyword ? value.name : typeof value === "string" ? value.trim().replace(/^:/, "") : "";
  const parts = output.split("/");
  if (
    !output
    || !IDENTIFIER.test(output)
    || output.includes("//")
    || parts.some((part) => part === "." || part === "..")
  ) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return output;
}

function text(value, label, { optional = false, maximum = LIMITS.text } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  const output = value.trim();
  if (output.length > maximum) throw new RangeError(`${label} exceeds the ${maximum}-character limit`);
  return output;
}

function boolean(value, label, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

export function normalizeRegistryPath(value, label, { optional = false, allowEmpty = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string") throw new TypeError(`${label} must be a relative path string`);
  const source = value.trim();
  if (!source && allowEmpty) return "";
  if (!source || source.startsWith("/") || source.endsWith("/") || source.includes("\\")) {
    throw new TypeError(`${label} must be a normalized relative path`);
  }
  const parts = source.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !PATH_SEGMENT.test(part))) {
    throw new TypeError(`${label} must be a normalized relative path`);
  }
  return parts.join("/");
}

function joinPath(...parts) {
  return parts.filter(Boolean).join("/");
}

function normalizeSource(value) {
  const source = record(value, "Showcase source");
  knownKeys(source, SOURCE_KEYS, "Showcase source");
  const repository = text(source["source/repository"], "Showcase source repository", { maximum: 201 });
  if (!REPOSITORY.test(repository) || repository.endsWith(".git")) {
    throw new TypeError("Showcase source repository must use GitHub owner/repository form");
  }
  const commit = text(source["source/commit"], "Showcase source commit", { maximum: 40 });
  if (!COMMIT.test(commit)) throw new TypeError("Showcase source commit must be a lowercase 40-character SHA");
  const branch = text(source["source/branch"], "Showcase source branch", { optional: true, maximum: 200 });
  const root = normalizeRegistryPath(source["source/root"] ?? "", "Showcase source root", { allowEmpty: true });
  return { repository, commit, ...(branch ? { branch } : {}), root };
}

function unique(records, field, label) {
  const seen = new Set();
  for (const value of records) {
    if (seen.has(value[field])) throw new Error(`Duplicate ${label} id: ${value[field]}`);
    seen.add(value[field]);
  }
  return seen;
}

function normalizeView(value, index) {
  const view = record(value, `Showcase view ${index}`);
  knownKeys(view, VIEW_KEYS, `Showcase view ${index}`);
  return {
    id: token(view["view/id"], `Showcase view ${index} id`),
    title: text(view["view/title"], `Showcase view ${index} title`, { maximum: LIMITS.title }),
    ...(view["view/summary"] == null ? {} : { summary: text(view["view/summary"], `Showcase view ${index} summary`) }),
    ...(view["view/source"] == null ? {} : { source: normalizeRegistryPath(view["view/source"], `Showcase view ${index} source`) }),
    ...(view["view/docs"] == null ? {} : { docs: normalizeRegistryPath(view["view/docs"], `Showcase view ${index} docs`) }),
  };
}

function plainStateValue(value, label, depth = 0, budget = { entries: 0 }) {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > LIMITS.stateString) throw new RangeError(`${label} string exceeds the length limit`);
    return value;
  }
  if (value instanceof EdnKeyword) return `:${value.name}`;
  if (depth >= LIMITS.stateDepth) throw new RangeError(`${label} exceeds the depth limit`);
  if (Array.isArray(value)) {
    budget.entries += value.length;
    if (budget.entries > LIMITS.stateEntries) throw new RangeError(`${label} exceeds the entry limit`);
    return value.map((entry, index) => plainStateValue(entry, `${label}[${index}]`, depth + 1, budget));
  }
  const input = record(value, label);
  const entries = Object.entries(input);
  budget.entries += entries.length;
  if (budget.entries > LIMITS.stateEntries) throw new RangeError(`${label} exceeds the entry limit`);
  const output = {};
  for (const [key, entry] of entries) {
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new TypeError(`${label} contains an unsafe map key`);
    }
    output[key] = plainStateValue(entry, `${label}.${key}`, depth + 1, budget);
  }
  return output;
}

function normalizeState(value, index) {
  const state = record(value, `Showcase state ${index}`);
  knownKeys(state, STATE_KEYS, `Showcase state ${index}`);
  const file = state["state/file"] == null
    ? null
    : normalizeRegistryPath(state["state/file"], `Showcase state ${index} file`);
  const hasValue = Object.hasOwn(state, "state/value");
  if (!file && !hasValue) throw new Error(`Showcase state ${index} requires :state/file or :state/value`);
  return {
    id: token(state["state/id"], `Showcase state ${index} id`),
    title: text(state["state/title"], `Showcase state ${index} title`, { maximum: LIMITS.title }),
    ...(state["state/summary"] == null ? {} : { summary: text(state["state/summary"], `Showcase state ${index} summary`) }),
    ...(file ? { file } : {}),
    ...(hasValue ? { value: plainStateValue(state["state/value"], `Showcase state ${index} value`) } : {}),
  };
}

function normalizeViewport(value, label) {
  if (value == null) return null;
  const viewport = record(value, label);
  knownKeys(viewport, VIEWPORT_KEYS, label);
  const width = Number(viewport["viewport/width"]);
  const height = Number(viewport["viewport/height"]);
  if (!Number.isSafeInteger(width) || width < 240 || width > 3840) {
    throw new RangeError(`${label} width must be an integer from 240 to 3840`);
  }
  if (!Number.isSafeInteger(height) || height < 180 || height > 2160) {
    throw new RangeError(`${label} height must be an integer from 180 to 2160`);
  }
  return { width, height };
}

function normalizeDemo(value, index) {
  const demo = record(value, `Showcase demo ${index}`);
  knownKeys(demo, DEMO_KEYS, `Showcase demo ${index}`);
  const tags = demo["demo/tags"] == null
    ? []
    : array(demo["demo/tags"], `Showcase demo ${index} tags`, LIMITS.tags)
      .map((entry, tagIndex) => text(entry, `Showcase demo ${index} tag ${tagIndex}`, { maximum: 64 }));
  const theme = token(demo["demo/theme"], `Showcase demo ${index} theme`, { optional: true });
  if (theme && theme !== "light" && theme !== "dark") {
    throw new Error(`Showcase demo ${index} theme must be :light or :dark`);
  }
  const viewport = normalizeViewport(demo["demo/viewport"], `Showcase demo ${index} viewport`);
  return {
    id: token(demo["demo/id"], `Showcase demo ${index} id`),
    title: text(demo["demo/title"], `Showcase demo ${index} title`, { maximum: LIMITS.title }),
    ...(demo["demo/summary"] == null ? {} : { summary: text(demo["demo/summary"], `Showcase demo ${index} summary`) }),
    view: token(demo["demo/view"], `Showcase demo ${index} view`),
    ...(demo["demo/state"] == null ? {} : { state: token(demo["demo/state"], `Showcase demo ${index} state`) }),
    project: normalizeRegistryPath(demo["demo/project"], `Showcase demo ${index} project`),
    surface: token(demo["demo/surface"], `Showcase demo ${index} surface`),
    ...(demo["demo/docs"] == null ? {} : { docs: normalizeRegistryPath(demo["demo/docs"], `Showcase demo ${index} docs`) }),
    ...(tags.length ? { tags } : {}),
    ...(theme ? { theme } : {}),
    ...(viewport ? { viewport } : {}),
    default: boolean(demo["demo/default"], `Showcase demo ${index} default`),
  };
}

export function playgroundShowcaseUrl(source, demo, origin = "https://playground.hara-lang.org") {
  const url = new URL("/", origin);
  url.searchParams.set("repo", source.repository);
  if (source.branch) url.searchParams.set("branch", source.branch);
  url.searchParams.set("commit", source.commit);
  url.searchParams.set("path", joinPath(source.root, demo.project));
  url.searchParams.set("presentation", "showcase");
  url.searchParams.set("surface", demo.surface);
  if (demo.theme) url.searchParams.set("theme", demo.theme);
  return url.href;
}

export function normalizeShowcaseManifest(value, {
  expectedPackage = null,
  expectedVersion = null,
  playgroundOrigin = "https://playground.hara-lang.org",
} = {}) {
  const manifest = record(value, "Showcase manifest");
  knownKeys(manifest, TOP_KEYS, "Showcase manifest");
  const type = token(manifest["hara/type"], "Showcase manifest :hara/type");
  if (type !== "showcase") throw new Error(`Expected :hara/type :showcase, received :${type}`);
  const format = manifest["showcase/format"];
  if (format !== SHOWCASE_FORMAT) throw new Error(`Unsupported Showcase format: ${manifest["showcase/format"]}`);
  const packageId = token(manifest["showcase/package"], "Showcase package");
  if (!PACKAGE_ID.test(packageId)) throw new TypeError("Showcase package must use lowercase owner/name form");
  const version = text(manifest["showcase/version"], "Showcase version", { maximum: 100 });
  if (!VERSION.test(version)) throw new TypeError("Showcase version must be a semantic version");
  if (expectedPackage && packageId !== expectedPackage) {
    throw new Error(`Showcase package ${packageId} does not match registry path ${expectedPackage}`);
  }
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(`Showcase version ${version} does not match registry path ${expectedVersion}`);
  }

  const source = normalizeSource(manifest["showcase/source"]);
  const views = array(manifest["showcase/views"] ?? [], "Showcase views", LIMITS.views).map(normalizeView);
  const states = array(manifest["showcase/states"] ?? [], "Showcase states", LIMITS.states).map(normalizeState);
  const demos = array(manifest["showcase/demos"] ?? [], "Showcase demos", LIMITS.demos).map(normalizeDemo);
  if (!views.length) throw new Error("Showcase manifest requires at least one view");
  if (!demos.length) throw new Error("Showcase manifest requires at least one demo");

  const viewIds = unique(views, "id", "view");
  const stateIds = unique(states, "id", "state");
  unique(demos, "id", "demo");
  let defaults = 0;
  for (const demo of demos) {
    if (!viewIds.has(demo.view)) throw new Error(`Showcase demo ${demo.id} references missing view ${demo.view}`);
    if (demo.state && !stateIds.has(demo.state)) throw new Error(`Showcase demo ${demo.id} references missing state ${demo.state}`);
    if (demo.default) defaults += 1;
    demo.playgroundUrl = playgroundShowcaseUrl(source, demo, playgroundOrigin);
  }
  if (defaults > 1) throw new Error("Showcase manifest may declare only one default demo");
  if (defaults === 0) demos[0].default = true;

  return {
    format,
    package: packageId,
    version,
    title: text(manifest["showcase/title"], "Showcase title", { maximum: LIMITS.title }),
    ...(manifest["showcase/summary"] == null ? {} : { summary: text(manifest["showcase/summary"], "Showcase summary") }),
    source,
    views,
    states,
    demos,
  };
}

export function parseShowcaseManifest(source, options = {}) {
  return normalizeShowcaseManifest(readEdnData(source), options);
}
