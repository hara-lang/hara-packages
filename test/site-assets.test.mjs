import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, theme, toggle, gallery, config, verifier, packageJson, versioner, browserVerifier] = await Promise.all([
  read("../site/index.html"),
  read("../site/vendor/visual-language/theme.css"),
  read("../site/theme-toggle.js"),
  read("../site/gallery.js"),
  read("../netlify.toml"),
  read("../.github/scripts/verify-static-assets.sh"),
  read("../package.json"),
  read("../scripts/version-site-assets.mjs"),
  read("../scripts/verify-gallery-browser.mjs"),
]);

const release = "20260809-1";
const mutableAssets = [
  "/vendor/visual-language/theme.css",
  "/page.css",
  "/public-shell.css",
  "/visual-refresh.css",
  "/theme-toggle.js",
  "/gallery.js",
];

test("the source page marks every mutable presentation edge for deployment versioning", () => {
  for (const asset of mutableAssets) {
    assert.ok(page.includes(`${asset}?v=${release}`), `${asset} is not cache-busted`);
  }
  assert.ok(theme.includes(`tokens.css?v=${release}`));
  assert.ok(toggle.includes(`theme.js?v=${release}`));
  assert.match(gallery, /const ASSET_VERSION = "20260809-1";/);
  assert.match(gallery, /gallery\.json\?v=\$\{ASSET_VERSION\}/);
});

test("Netlify preserves origin revalidation for mutable asset paths", () => {
  for (const asset of [
    "/page.css",
    "/public-shell.css",
    "/visual-refresh.css",
    "/theme-toggle.js",
    "/gallery.js",
    "/gallery.json",
    "/index.json",
    "/vendor/visual-language/theme.css",
    "/vendor/visual-language/tokens.css",
    "/vendor/visual-language/theme.js",
  ]) {
    const start = config.indexOf(`for = "${asset}"`);
    assert.notEqual(start, -1, `${asset} has no Netlify header block`);
    const next = config.indexOf("[[headers]]", start + 1);
    const block = config.slice(start, next === -1 ? config.length : next);
    assert.match(block, /Cache-Control = "public, max-age=0, must-revalidate"/);
    assert.match(block, /X-Content-Type-Options = "nosniff"/);
  }
});

test("the deployment versioner and live verifier prove exact public bytes", () => {
  assert.match(packageJson, /"assets:version": "node scripts\/version-site-assets\.mjs"/);
  assert.match(versioner, /40-character Git commit SHA/);
  assert.match(verifier, /HARA_ASSET_VERSION/);
  assert.match(verifier, /sha256sum/);
  assert.match(verifier, /did not return the bytes deployed/);
  assert.match(verifier, /Verified commit-addressed Packages assets/);
  assert.doesNotMatch(verifier, /max-age=0.*exit 1/s);
});

test("the Chromium empty-state fixture accepts the versioned Gallery index URL", () => {
  assert.match(browserVerifier, /emptyPage\.route\("\*\*\/gallery\.json\*"/);
});
