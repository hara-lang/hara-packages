import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/publish-packages.yml", import.meta.url), "utf8");

test("the dedicated workflow validates untrusted receipt PRs without a GHCR credential", () => {
  assert.match(workflow, /name: Publish Hara packages/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /Validate GitHub-governed publication receipts/);
  assert.match(workflow, /cosign verify-blob/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("  publish:")), /HARA_PACKAGES_GHCR_TOKEN/);
});

test("only the protected post-merge job rebuilds and publishes paired GHCR artifacts", () => {
  assert.match(workflow, /environment: hara-packages-publish/);
  assert.match(workflow, /HARA_PACKAGES_GHCR_TOKEN/);
  assert.match(workflow, /ghcr\.io\/hara-packages\/\$\{image\}/);
  assert.match(workflow, /\$\{image\}\.specs/);
  assert.match(workflow, /git -C "\$work\/source" verify-tag/);
  assert.match(workflow, /refs\/tags\/\$\{native_tag\}/);
  assert.match(workflow, /releases\/tags\/\$\{native_tag\}/);
  assert.match(workflow, /release-manifest\.json/);
  assert.match(workflow, /bundle build "\$work\/source/);
  assert.match(workflow, /prepare-specs-project\.mjs/);
  assert.match(workflow, /application\/vnd\.hara\.harp\.v1\+zip/);
  assert.match(workflow, /oras manifest fetch --output "\$work\/source-final\.json"/);
  assert.match(workflow, /visibility=public/);
});
