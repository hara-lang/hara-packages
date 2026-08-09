import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, theme, toggle, config, verifier] = await Promise.all([
  read("../site/index.html"),
  read("../site/vendor/visual-language/theme.css"),
  read("../site/theme-toggle.js"),
  read("../netlify.toml"),
  read("../.github/scripts/verify-static-assets.sh"),
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

test("the public page cache-busts every mutable presentation asset", () => {
  for (const asset of mutableAssets) {
    assert.ok(page.includes(`${asset}?v=${release}`), `${asset} is not cache-busted`);
  }
  assert.ok(theme.includes(`tokens.css?v=${release}`));
  assert.ok(toggle.includes(`theme.js?v=${release}`));
});

test("Netlify requires mutable assets to revalidate", () => {
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

test("the live verifier checks MIME, cache and document references", () => {
  assert.match(verifier, /content-type:/i);
  assert.match(verifier, /max-age=0/);
  assert.match(verifier, /must-revalidate/);
  assert.match(verifier, /Verified cache-safe Packages assets/);
});
