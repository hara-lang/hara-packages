import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_ASSET_VERSION = "20260809-1";
export const DEPLOY_VERSION_PATTERN = /^[0-9a-f]{40}$/;
export const VERSIONED_SITE_FILES = Object.freeze([
  "site/index.html",
  "site/vendor/visual-language/theme.css",
  "site/theme-toggle.js",
  "site/gallery.js",
]);

function versionQueries(text, version) {
  return text.replace(
    /(\?v=)(?:20260809-1|[0-9a-f]{40})/g,
    `$1${version}`,
  );
}

function versionGalleryConstant(text, version) {
  return text.replace(
    /(const ASSET_VERSION = ")(?:20260809-1|[0-9a-f]{40})(";)/,
    `$1${version}$2`,
  );
}

export async function versionSiteAssets(version, {
  root = process.cwd(),
  files = VERSIONED_SITE_FILES,
} = {}) {
  if (!DEPLOY_VERSION_PATTERN.test(version)) {
    throw new TypeError("The deployed asset version must be one exact 40-character Git commit SHA.");
  }

  const changed = [];
  for (const relative of files) {
    const filename = path.resolve(root, relative);
    const source = await readFile(filename, "utf8");
    const next = versionGalleryConstant(versionQueries(source, version), version);
    if (next === source) {
      throw new Error(`No versioned asset marker was found in ${relative}.`);
    }
    await writeFile(filename, next);
    changed.push(relative);
  }
  return changed;
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const version = String(process.argv[2] || "").trim();
  const changed = await versionSiteAssets(version);
  console.log(`Versioned ${changed.length} Packages asset documents at ${version}.`);
}
