import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../site/page.css", import.meta.url), "utf8");

test("renders the shared Hara identity in the package shell", () => {
  assert.match(page, /data-hara-identity/);
  assert.match(page, /https:\/\/id\.hara-lang\.org/);
  assert.match(page, /https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(page, /identity-client\.js/);
  assert.match(page, /location\.hostname.*packages\.testing\.hara-lang\.org/s);
  assert.doesNotMatch(page, /client_secret|access_token|\/auth\/github\/callback/);
});

test("keeps the brand and identity on the shell borders", () => {
  assert.match(styles, /grid-template-columns: 1fr auto 1fr/);
  assert.match(styles, /\.site-header > \[data-hara-identity\] \{ justify-self: end; \}/);
  assert.match(page, /Home[\s\S]*Specs[\s\S]*aria-current="page">Packages[\s\S]*Identity/);
});
