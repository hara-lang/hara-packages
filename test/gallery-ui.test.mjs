import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allowedPlaygroundUrl,
  displayStateValue,
  exactRepositoryUrl,
  exactSourceUrl,
  galleryDeepLink,
  galleryRequestFromLocation,
  galleryStoryCount,
  normalizeGalleryPath,
  normalizeGallerySelector,
  resolveGallerySelection,
} from "../site/gallery.js";

const COMMIT = "a".repeat(40);
const index = {
  format: 1,
  registry: "hara",
  packages: [{
    id: "hara/example",
    versions: [{
      package: "hara/example",
      version: "0.1.0",
      title: "Example UI",
      registryPath: "packages/hara/example/0.1.0.showcase.edn",
      source: {
        repository: "hara-lang/example",
        branch: "main",
        commit: COMMIT,
        root: "examples",
      },
      views: [{ id: "card", title: "Card", source: "src/example/card.hal", docs: "docs/card.md" }],
      states: [{ id: "default", title: "Default", file: "showcase/states/default.edn", value: { title: "Hello", tone: ":calm" } }],
      demos: [{
        id: "card/default",
        title: "Default card",
        view: "card",
        state: "default",
        project: "showcase/card-default",
        surface: "preview",
        docs: "showcase/card-default/README.md",
        default: true,
        playgroundUrl: `https://playground.hara-lang.org/?repo=hara-lang/example&commit=${COMMIT}&path=examples/showcase/card-default&presentation=showcase&surface=preview`,
      }],
    }],
  }],
};

test("resolves package, version, demo, view and named state as one immutable story", () => {
  const selection = resolveGallerySelection(index, {
    packageId: "hara/example",
    version: "0.1.0",
    demoId: "card/default",
  });
  assert.equal(selection.packageEntry.id, "hara/example");
  assert.equal(selection.version.source.commit, COMMIT);
  assert.equal(selection.demo.surface, "preview");
  assert.equal(selection.view.source, "src/example/card.hal");
  assert.equal(selection.state.value.title, "Hello");
  assert.equal(galleryStoryCount(index), 1);
});

test("Gallery deep links carry bounded selectors and panel presentation", () => {
  const selection = resolveGallerySelection(index);
  const href = galleryDeepLink(selection, {
    surface: "document",
    tab: "source",
    viewport: "mobile",
    theme: "dark",
  }, { href: "https://packages.hara-lang.org/" });
  const url = new URL(href);
  assert.equal(url.searchParams.get("package"), "hara/example");
  assert.equal(url.searchParams.get("version"), "0.1.0");
  assert.equal(url.searchParams.get("demo"), "card/default");
  assert.equal(url.searchParams.get("surface"), "document");
  assert.equal(url.searchParams.get("tab"), "source");
  assert.equal(url.searchParams.get("viewport"), "mobile");
  assert.equal(url.searchParams.get("theme"), "dark");

  assert.deepEqual(galleryRequestFromLocation({ search: url.search }), {
    packageId: "hara/example",
    version: "0.1.0",
    demoId: "card/default",
    surface: "document",
    tab: "source",
    viewport: "mobile",
    theme: "dark",
  });
});

test("exact source links remain commit-pinned and normalized", () => {
  const source = index.packages[0].versions[0].source;
  assert.equal(
    exactSourceUrl(source, "src/example/card.hal"),
    `https://github.com/hara-lang/example/blob/${COMMIT}/examples/src/example/card.hal`,
  );
  assert.equal(
    exactSourceUrl(source, "src/example/card.hal", { raw: true }),
    `https://raw.githubusercontent.com/hara-lang/example/${COMMIT}/examples/src/example/card.hal`,
  );
  assert.equal(
    exactRepositoryUrl(source),
    `https://github.com/hara-lang/example/tree/${COMMIT}/examples`,
  );
  assert.throws(() => normalizeGalleryPath("../secret"), /normalized relative path/);
  assert.throws(() => normalizeGallerySelector("../../demo"), /bounded package selector/);
  assert.throws(() => exactSourceUrl({ ...source, commit: "main" }, "src/main.hal"), /exact GitHub commit/);
});

test("only known Playground origins or same-protocol local fixtures can host code", () => {
  assert.equal(
    allowedPlaygroundUrl("https://playground.hara-lang.org/?presentation=showcase", {
      href: "https://packages.hara-lang.org/",
    }).origin,
    "https://playground.hara-lang.org",
  );
  assert.throws(
    () => allowedPlaygroundUrl("https://malicious.example/demo", { href: "https://packages.hara-lang.org/" }),
    /Untrusted Playground origin/,
  );
  assert.equal(
    allowedPlaygroundUrl("http://127.0.0.1:4100/mock", { href: "http://localhost:4173/" }).hostname,
    "127.0.0.1",
  );
});

test("named state values are displayed as inert serialized data", () => {
  assert.equal(displayStateValue({ title: "<script>no</script>", tone: ":calm" }), '{\n  "title": "<script>no</script>",\n  "tone": ":calm"\n}\n');
});

test("the static Gallery shell keeps package code inside the sandboxed Playground frame", async () => {
  const page = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../site/gallery.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../site/page.css", import.meta.url), "utf8");
  assert.match(page, /data-gallery-tab="canvas"/);
  assert.match(page, /data-gallery-tab="state"/);
  assert.match(page, /data-gallery-tab="source"/);
  assert.match(page, /data-gallery-tab="docs"/);
  assert.match(page, /sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock"/);
  assert.doesNotMatch(page, /allow-top-navigation|allow-popups-to-escape-sandbox/);
  assert.match(page, /data-hara-identity/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML|eval\(|new Function|document\.write/);
  assert.match(script, /event\.source !== this\.elements\.frame\.contentWindow/);
  assert.match(script, /event\.origin !== expected/);
  assert.match(script, /https:\/\/raw\.githubusercontent\.com/);
  assert.match(styles, /grid-template-columns: 1fr auto 1fr/);
  assert.match(styles, /\.site-header > \[data-hara-identity\] \{ justify-self: end; \}/);
});

test("the Package Gallery browser gate is path-scoped and read-only", async () => {
  const workflow = await readFile(new URL("../.github/workflows/gallery-browser.yml", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/verify-gallery-browser.mjs", import.meta.url), "utf8");
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /playwright@1\.53\.2/);
  assert.match(workflow, /npm run validate/);
  assert.match(workflow, /verify-gallery-browser\.mjs/);
  assert.match(runner, /data-gallery-tab=\\?"state/);
  assert.match(runner, /data-gallery-tab=\\?"source/);
  assert.match(runner, /data-gallery-tab=\\?"docs/);
  assert.match(runner, /data-gallery-surface/);
  assert.match(runner, /Publish the demo beside the code/);
});
