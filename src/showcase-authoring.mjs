import { readEdnData } from "./edn.mjs";
import { normalizeShowcaseManifest } from "./showcase.mjs";

const AUTHORING_KEYS = new Set([
  "hara/type",
  "showcase/format",
  "showcase/package",
  "showcase/version",
  "showcase/title",
  "showcase/summary",
  "showcase/views",
  "showcase/states",
  "showcase/demos",
]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a map`);
  }
  return value;
}

function knownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field :${key}`);
  }
}

function publicationSource(value) {
  const source = record(value, "Publication source");
  const repository = typeof source.repository === "string" ? source.repository : "";
  const commit = typeof source.commit === "string" ? source.commit : "";
  const branch = typeof source.branch === "string" && source.branch ? source.branch : null;
  const root = typeof source.root === "string" ? source.root : "";
  return {
    "source/repository": repository,
    "source/commit": commit,
    ...(branch ? { "source/branch": branch } : {}),
    "source/root": root,
  };
}

/**
 * Normalize a package-local Showcase authoring manifest.
 *
 * Source repositories cannot place their own immutable commit inside a file at
 * that same commit. Publication therefore supplies the reviewed source
 * identity and this function materializes the finalized registry form before
 * normal Showcase validation and preflight.
 */
export function normalizeShowcaseAuthoringManifest(value, {
  source,
  expectedPackage = null,
  expectedVersion = null,
  playgroundOrigin = "https://playground.hara-lang.org",
} = {}) {
  const manifest = record(value, "Showcase authoring manifest");
  knownKeys(manifest, AUTHORING_KEYS, "Showcase authoring manifest");
  if (!source) throw new TypeError("Showcase authoring requires an immutable publication source");

  return normalizeShowcaseManifest({
    ...manifest,
    "showcase/source": publicationSource(source),
  }, {
    expectedPackage,
    expectedVersion,
    playgroundOrigin,
  });
}

export function parseShowcaseAuthoringManifest(sourceText, options = {}) {
  return normalizeShowcaseAuthoringManifest(readEdnData(sourceText), options);
}
