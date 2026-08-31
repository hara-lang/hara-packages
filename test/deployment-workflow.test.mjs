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

test("keeps the site deployment read-only; package publication belongs to the dedicated workflow", () => {
  assert.doesNotMatch(workflow, /packages: write/);
  assert.doesNotMatch(workflow, /oras-project\/setup-oras/);
  assert.doesNotMatch(workflow, /registry\.edn/);
  assert.doesNotMatch(workflow, /publication\.zip/);
  assert.match(workflow, /Deploy main to packages\.hara-lang\.org/);
});
