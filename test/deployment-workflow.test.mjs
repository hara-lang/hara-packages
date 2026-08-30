import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("deploys testing and production from their intended branches", () => {
  assert.match(workflow, /branches: \[main, testing\]/);
  assert.match(workflow, /github\.ref_name == 'testing'[\s\S]*NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /github\.ref_name == 'main'[\s\S]*NETLIFY_PRODUCTION_SITE_ID/);
  assert.doesNotMatch(workflow, /branches: \[main, production\]/);
  assert.doesNotMatch(workflow, /pull_request\.title|\[deploy\]/);
});

test("publishes the checked-in registry as a provenance-labelled GHCR artifact before Netlify", () => {
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /oras-project\/setup-oras@v1/);
  assert.match(workflow, /Publish registry artifact to GitHub Packages/);
  assert.match(workflow, /ghcr\.io\/\$\{GITHUB_REPOSITORY\}/);
  assert.match(workflow, /registry\.edn:application\/vnd\.hara\.registry\.v1\+edn/);
  assert.match(workflow, /org\.opencontainers\.image\.source=https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}/);
  assert.match(workflow, /org\.opencontainers\.image\.revision=\$\{GITHUB_SHA\}/);
  assert.match(workflow, /Publish registry artifact to GitHub Packages\n\s+if: github\.ref_name == 'main'/);
  assert.match(workflow, /Verify published GitHub Packages registry artifact/);
  assert.match(workflow, /oras manifest fetch --output "\$manifest_path" "\$registry:sha-\$\{GITHUB_SHA\}"/);
  assert.match(workflow, /oras blob fetch --output "\$layer_path" "\$registry@\$layer_digest"/);
  assert.match(workflow, /org\.opencontainers\.image\.source/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /application\/vnd\.hara\.registry\.v1\+edn/);
  assert.match(workflow, /shasum -a 256/);
  assert.ok(
    workflow.indexOf("Publish registry artifact to GitHub Packages") < workflow.indexOf("Deploy main to packages.hara-lang.org"),
    "the endpoint must never deploy before its GHCR artifact exists",
  );
  assert.ok(
    workflow.indexOf("Verify published GitHub Packages registry artifact") < workflow.indexOf("Deploy main to packages.hara-lang.org"),
    "the endpoint must never deploy before the immutable GHCR artifact is proven",
  );
});
