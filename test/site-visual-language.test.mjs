import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, refresh, tokens, theme, themeScript, shell, toggle, source] = await Promise.all([
  read("../site/index.html"),
  read("../site/visual-refresh.css"),
  read("../site/vendor/visual-language/tokens.css"),
  read("../site/vendor/visual-language/theme.css"),
  read("../site/vendor/visual-language/theme.js"),
  read("../site/public-shell.css"),
  read("../site/theme-toggle.js"),
  read("../site/vendor/visual-language/SOURCE.md"),
]);

test("packages consumes the public visual-language layer instead of editor tokens", () => {
  assert.match(page, /vendor\/visual-language\/theme\.css/);
  assert.match(page, /visual-refresh\.css/);
  assert.match(page, /public-shell\.css/);
  assert.match(page, /vendor\/visual-language\/hara-logo\.svg/);
  assert.doesNotMatch(page, /vendor\/hara-ui\/tokens\.css/);
  assert.match(source, /hara-lang\/visual-language/);
  assert.match(source, /v1\.0\.0/);
});

test("the gallery maps its workbench onto frost, graphite and one signal colour", () => {
  assert.match(tokens, /--hara-signal: #2f7cff/);
  assert.match(tokens, /--hara-void: #050608/);
  assert.match(tokens, /--hara-frost: #f4f6f8/);
  assert.match(tokens, /--hara-metal-plate: #11151a/);
  assert.match(refresh, /--hara-cyan: var\(--hara-signal\)/);
  assert.match(refresh, /--hara-magenta: var\(--hara-signal\)/);
  assert.match(refresh, /--hara-glow-cyan: none/);
  assert.match(refresh, /backgrounds\/ast-field\.svg/);
  assert.doesNotMatch(refresh, /#41f5e4|#ff2e88|#9c7bff|aurora/);
});

test("theme and accessibility behaviour stay shared with the Hara domain", () => {
  assert.match(theme, /@import "\.\/tokens\.css"/);
  assert.match(theme, /:focus-visible/);
  assert.match(theme, /prefers-reduced-motion/);
  assert.match(themeScript, /Domain=hara-lang\.org/);
  assert.match(themeScript, /system", "light", "dark/);
  assert.match(toggle, /cycleTheme/);
  assert.match(shell, /data-hara-theme-label/);
  assert.match(page, /aria-label="Change colour theme"/);
});
