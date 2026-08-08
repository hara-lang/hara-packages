import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseShowcaseManifest, SHOWCASE_SIDECAR_SUFFIX } from "./showcase.mjs";

const SIDECAR = /^packages\/([^/]+)\/([^/]+)\/([^/]+)\.showcase\.edn$/;

async function walk(directory, output = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else if (entry.isFile() && entry.name.endsWith(SHOWCASE_SIDECAR_SUFFIX)) output.push(path);
  }
  return output;
}

function repositoryRelative(root, path) {
  const value = relative(root, path).split(sep).join("/");
  if (!value || value.startsWith("../") || value.includes("/../")) {
    throw new Error(`Gallery path escaped the repository root: ${path}`);
  }
  return value;
}

async function requireReleaseRecord(path, version) {
  const release = join(dirname(path), `${version}.edn`);
  try {
    await access(release, constants.R_OK);
  } catch {
    throw new Error(`Showcase sidecar requires sibling finalized release record: ${release}`);
  }
  return release;
}

function packageGroups(showcases) {
  const packages = [];
  let current = null;
  for (const showcase of showcases) {
    if (!current || current.id !== showcase.package) {
      current = { id: showcase.package, versions: [] };
      packages.push(current);
    }
    current.versions.push(showcase);
  }
  return packages;
}

export async function buildGalleryIndex({
  root = process.cwd(),
  packagesRoot = "packages",
  playgroundOrigin = "https://playground.hara-lang.org",
} = {}) {
  const repositoryRoot = resolve(root);
  const files = await walk(resolve(repositoryRoot, packagesRoot));
  const showcases = [];

  for (const path of files) {
    const registryPath = repositoryRelative(repositoryRoot, path);
    const match = SIDECAR.exec(registryPath);
    if (!match) throw new Error(`Invalid Showcase sidecar path: ${registryPath}`);
    const [, owner, name, version] = match;
    const packageId = `${owner}/${name}`;
    await requireReleaseRecord(path, version);
    const source = await readFile(path, "utf8");
    const showcase = parseShowcaseManifest(source, {
      expectedPackage: packageId,
      expectedVersion: version,
      playgroundOrigin,
    });
    showcase.registryPath = registryPath;
    showcases.push(showcase);
  }

  showcases.sort((left, right) =>
    left.package.localeCompare(right.package)
      || right.version.localeCompare(left.version));

  return {
    format: 1,
    registry: "hara",
    packages: packageGroups(showcases),
  };
}

export function galleryIndexJson(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export async function generateGalleryIndex({
  root = process.cwd(),
  output = "site/gallery.json",
  check = false,
  playgroundOrigin = "https://playground.hara-lang.org",
} = {}) {
  const repositoryRoot = resolve(root);
  const index = await buildGalleryIndex({ root: repositoryRoot, playgroundOrigin });
  const content = galleryIndexJson(index);
  const destination = resolve(repositoryRoot, output);
  if (check) {
    let current;
    try {
      current = await readFile(destination, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Generated Gallery index is missing: ${output}`);
      throw error;
    }
    if (current !== content) throw new Error(`Generated Gallery index is stale: ${output}`);
    return { index, content, output: destination, changed: false };
  }
  await writeFile(destination, content, "utf8");
  return { index, content, output: destination, changed: true };
}
