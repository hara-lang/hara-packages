import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const authorityPath = resolve(root, "publishing-authority.json");

const expected = Object.freeze({
  repository: "hara-lang/hara-specs-registry",
  commit: "64d81ebe5fded2809c6fc4414796a3feddf98a33",
  path: "02-platform/000009-publishing/draft/hara-publishing.edn",
  gitBlobSha: "5c45f9f17bb0bd736d33628624c47a8d691faa8f",
  status: "draft",
});

const requiredOperations = new Set([
  "hara.publishing.operation/sign-in",
  "hara.publishing.operation/submit",
  "hara.publishing.operation/build",
  "hara.publishing.operation/finalize",
]);

const requiredInvariants = new Set([
  "hara.publishing/github-identity",
  "hara.publishing/project-authority",
  "hara.publishing/exact-source",
  "hara.publishing/credential-separation",
  "hara.publishing/reproducible",
  "hara.publishing/accepted-git-only",
  "hara.publishing/git-commit-point",
  "hara.publishing/idempotent",
]);

const fail = (message) => {
  throw new Error(`publishing-authority: ${message}`);
};

const exactStringSet = (value, expectedSet, label) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${label} must be a string array`);
  }
  const actual = new Set(value);
  if (actual.size !== value.length) fail(`${label} contains duplicates`);
  const missing = [...expectedSet].filter((item) => !actual.has(item));
  const extra = [...actual].filter((item) => !expectedSet.has(item));
  if (missing.length || extra.length) {
    fail(`${label} mismatch: missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`);
  }
};

const document = JSON.parse(await readFile(authorityPath, "utf8"));
if (document.schemaVersion !== 1) fail("schemaVersion must be 1");

for (const [key, value] of Object.entries(expected)) {
  if (document.normative?.[key] !== value) {
    fail(`normative.${key} must be ${JSON.stringify(value)}`);
  }
}

exactStringSet(document.operations, requiredOperations, "operations");
exactStringSet(document.invariants, requiredInvariants, "invariants");

for (const key of ["conformanceDocument", "requestDocument"]) {
  const path = document.implementation?.[key];
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("..")) {
    fail(`implementation.${key} must be a safe repository-relative path`);
  }
  await readFile(resolve(root, path), "utf8");
}

const conformance = await readFile(resolve(root, document.implementation.conformanceDocument), "utf8");
for (const value of [expected.repository, expected.commit, expected.path]) {
  if (!conformance.includes(value)) fail(`conformance document does not cite ${value}`);
}

console.log(`validated Publishing authority ${expected.repository}@${expected.commit}`);
