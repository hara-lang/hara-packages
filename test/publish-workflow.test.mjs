import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/publish-packages.yml", import.meta.url), "utf8");

test("the dedicated workflow validates untrusted receipt PRs without a GHCR credential", () => {
  assert.match(workflow, /name: Publish Hara packages/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /Validate GitHub-governed publication receipts/);
  assert.match(workflow, /cosign verify-blob/);
  assert.match(workflow, /--certificate-identity-regexp/);
  assert.match(workflow, /refs\/\(tags\/\$\{tag_re\}\|heads\/main\)/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("  publish:")), /HARA_PACKAGES_GHCR_TOKEN/);
});

test("only the protected post-merge job rebuilds and publishes the root and semantic GHCR graph", () => {
  assert.match(workflow, /environment: hara-packages-publish/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /GHCR_USERNAME: \$\{\{ github\.actor \}\}/);
  assert.match(workflow, /printf '%s' "\$GH_TOKEN" \| oras login ghcr\.io/);
  assert.doesNotMatch(workflow, /HARA_PACKAGES_GHCR_TOKEN/);
  assert.match(workflow, /ghcr\.io\/hara-packages\/\$\{image\}/);
  assert.match(workflow, /\$\{image\}\.specs/);
  assert.match(workflow, /git -C "\$work\/source" verify-tag/);
  assert.match(workflow, /refs\/tags\/\$\{native_tag\}/);
  assert.match(workflow, /releases\/tags\/\$\{native_tag\}/);
  assert.match(workflow, /release-manifest\.json/);
  assert.match(workflow, /bundle build "\$work\/source/);
  assert.match(workflow, /prepare-specs-project\.mjs/);
  assert.match(workflow, /distribution build "\$work\/source\/\$project_path" --output "\$work\/hara"/);
  assert.match(workflow, /\$work\/hara\/bin\/hara" deploy build --root "\$work\/source\/\$project_path"/);
  assert.match(workflow, /bundle inspect "\$archive" --json/);
  assert.match(workflow, /semantic_archives/);
  assert.match(workflow, /\.packages\.\$\{package_name\/\/\\\/\/\.\}/);
  assert.match(workflow, /application\/vnd\.hara\.harp\.v1\+zip/);
  assert.match(workflow, /oras manifest fetch --output "\$work\/source-final\.json"/);
  assert.match(workflow, /visibility=public/);
});
