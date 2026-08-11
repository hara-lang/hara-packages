import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  parsePublicationRequest,
  publicationRequestPath,
} from "./publication-request.mjs";
import {
  preparePublicationCandidate,
  stableJson,
} from "./publication-candidate.mjs";

export const PUBLICATION_CANDIDATE_INDEX = "requests/candidates/index.json";

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const output = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

function repositoryPath(root, path) {
  return relative(root, path).split(sep).join("/");
}

export async function publicationRequestFiles(root = process.cwd()) {
  const requests = resolve(root, "requests");
  return (await walk(requests))
    .map((path) => repositoryPath(root, path))
    .filter((path) => path.endsWith(".edn"))
    .filter((path) => !path.startsWith("requests/candidates/"))
    .sort();
}

export async function buildPublicationCandidateIndex({
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  tokenValue = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  apiOrigin = "https://api.github.com",
  rawOrigin = "https://raw.githubusercontent.com",
  preflight,
} = {}) {
  const candidates = [];
  for (const path of await publicationRequestFiles(root)) {
    const expected = publicationRequestPath(path);
    const source = await readFile(resolve(root, path), "utf8");
    const request = parsePublicationRequest(source, {
      expectedPackage: expected.package,
      expectedVersion: expected.version,
      requestPath: path,
    });
    candidates.push(await preparePublicationCandidate(request, {
      fetchImpl,
      tokenValue,
      apiOrigin,
      rawOrigin,
      ...(preflight ? { preflight } : {}),
    }));
  }
  return {
    format: "0.0.0-alpha",
    registry: "hara",
    candidates: candidates.sort((left, right) =>
      left.package.localeCompare(right.package)
        || left.version.localeCompare(right.version)
        || left.request.localeCompare(right.request)),
  };
}

export function publicationCandidateIndexSource(index) {
  return `${stableJson(index, 2)}\n`;
}

export async function writePublicationCandidateIndex({
  root = process.cwd(),
  check = false,
  ...options
} = {}) {
  const index = await buildPublicationCandidateIndex({ root, ...options });
  const expected = publicationCandidateIndexSource(index);
  const output = resolve(root, PUBLICATION_CANDIDATE_INDEX);
  if (check) {
    let current = null;
    try {
      current = await readFile(output, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current !== expected) {
      throw new Error(`${PUBLICATION_CANDIDATE_INDEX} is stale; run npm run requests:build`);
    }
  } else {
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, expected, "utf8");
  }
  return index;
}
