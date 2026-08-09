import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEPLOY_VERSION_PATTERN,
  SOURCE_ASSET_VERSION,
  versionSiteAssets,
} from "../scripts/version-site-assets.mjs";

test("versions every public asset edge with one exact commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hara-packages-assets-"));
  const files = ["index.html", "theme.css", "theme-toggle.js", "gallery.js"];
  try {
    for (const file of files) {
      await writeFile(path.join(root, file), file === "gallery.js"
        ? `const ASSET_VERSION = "${SOURCE_ASSET_VERSION}";\nfetch(\`./gallery.json?v=\${ASSET_VERSION}\`);\n`
        : `asset?v=${SOURCE_ASSET_VERSION}\n`);
    }
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    assert.equal(DEPLOY_VERSION_PATTERN.test(first), true);
    await versionSiteAssets(first, { root, files });
    await versionSiteAssets(second, { root, files });
    for (const file of files) {
      const output = await readFile(path.join(root, file), "utf8");
      assert.doesNotMatch(output, new RegExp(SOURCE_ASSET_VERSION));
      assert.doesNotMatch(output, new RegExp(first));
      assert.match(output, new RegExp(second));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects versions that are not exact Git commit SHAs", async () => {
  await assert.rejects(
    versionSiteAssets("release-latest", { root: ".", files: [] }),
    /40-character Git commit SHA/,
  );
});
