import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("validation and deployment preflight finalized package Showcases", async () => {
  const [packageJson, validate, pages, browser, command] = await Promise.all([
    read("package.json"),
    read(".github/workflows/validate.yml"),
    read(".github/workflows/pages.yml"),
    read(".github/workflows/gallery-browser.yml"),
    read("scripts/preflight-showcases.mjs"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(scripts["showcase:preflight"], "node scripts/preflight-showcases.mjs");
  assert.match(scripts.validate, /npm run showcase:preflight/);
  assert.match(validate, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(browser, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(browser, /packages\/\*\*/);
  assert.match(pages, /name: Preflight published package Showcases/);
  assert.ok(
    pages.indexOf("npm run showcase:preflight") < pages.indexOf("npm run gallery:build"),
    "deployment must preflight immutable Showcase sources before generating the Gallery",
  );
  assert.match(command, /buildGalleryIndex/);
  assert.match(command, /preflightGalleryIndex/);
});
