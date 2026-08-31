#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new TypeError(`${label} must be a non-empty repository-relative path`);
  }
  return value;
}

function ednString(value) {
  return JSON.stringify(value);
}

async function directoryEntries(path) {
  return (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
}

async function copyTree(source, destination, root, files) {
  for (const entry of await directoryEntries(source)) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError(`spec entries must not be symbolic links: ${input}`);
    if (entry.isDirectory()) {
      await mkdir(output, { recursive: false });
      await copyTree(input, output, root, files);
    } else if (entry.isFile()) {
      const bytes = await readFile(input);
      await writeFile(output, bytes);
      const path = relative(root, input).split(sep).join("/");
      files.push({ path, sha256: SHA256(bytes), size: bytes.byteLength });
    } else {
      throw new TypeError(`spec entries must be regular files: ${input}`);
    }
  }
}

function specsProject({ coordinate, version }) {
  return `{:hara/type :project\n :hara/version "1.0.0"\n :project/id ${ednString(`${coordinate}.specs`)}\n :project/version ${ednString(version)}\n :project/source-paths []\n :project/test-paths []\n :project/extension-paths []\n :project/artifact-paths ["spec"]\n :project/capabilities #{}}\n`;
}

export async function prepareSpecsProject({ sourceRoot, outputRoot, specsPath, coordinate, version }) {
  const source = resolve(sourceRoot);
  const output = resolve(outputRoot);
  const path = safeRelativePath(specsPath, "specs path");
  if (typeof coordinate !== "string" || !coordinate) throw new TypeError("coordinate must be a non-empty string");
  if (typeof version !== "string" || !version) throw new TypeError("version must be a non-empty string");
  try {
    const existing = await readdir(output);
    if (existing.length > 0) throw new TypeError("specs project output directory must be empty");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(output, { recursive: true });
  }
  const destination = join(output, "spec");
  await mkdir(destination);
  const input = join(source, path);
  const files = [];
  try {
    const sourceStats = await stat(input);
    if (!sourceStats.isDirectory()) throw new TypeError(`specs path is not a directory: ${path}`);
    await copyTree(input, destination, input, files);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    format: "hara-specs/1",
    source: { coordinate, version, path },
    files,
  };
  await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, "project.edn"), specsProject({ coordinate, version }));
  return { files, manifest, root: output };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourceRoot, outputRoot, specsPath, coordinate, version] = process.argv.slice(2);
  if (!sourceRoot || !outputRoot || !specsPath || !coordinate || !version || process.argv.length !== 7) {
    console.error("usage: prepare-specs-project SOURCE_ROOT OUTPUT_ROOT SPEC_PATH COORDINATE VERSION");
    process.exitCode = 2;
  } else {
    try {
      const result = await prepareSpecsProject({ sourceRoot, outputRoot, specsPath, coordinate, version });
      console.log(JSON.stringify({ files: result.files.length, manifest: join(result.root, "spec/manifest.json") }));
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
  }
}
