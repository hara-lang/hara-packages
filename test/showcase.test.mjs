import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EdnDataError, EdnKeyword, readEdnData } from "../src/edn.mjs";
import { buildGalleryIndex, galleryIndexJson } from "../src/gallery.mjs";
import { parseShowcaseManifest } from "../src/showcase.mjs";

const COMMIT = "a".repeat(40);
const VALID = `
{:hara/type :showcase
 :showcase/format \"0.0.0-alpha\"
 :showcase/package :hara/example
 :showcase/version "0.1.0"
 :showcase/title "Example UI"
 :showcase/summary "A reviewable package Showcase."
 :showcase/source {:source/repository "hara-lang/example"
                   :source/branch "main"
                   :source/commit "${COMMIT}"
                   :source/root "examples"}
 :showcase/views [{:view/id :card
                   :view/title "Card"
                   :view/source "src/example/card.hal"
                   :view/docs "docs/card.md"}]
 :showcase/states [{:state/id :default
                    :state/title "Default"
                    :state/file "showcase/states/default.edn"
                    :state/value {:title "Hello" :tone :calm}}]
 :showcase/demos [{:demo/id :card/default
                   :demo/title "Default card"
                   :demo/view :card
                   :demo/state :default
                   :demo/project "showcase/card-default"
                   :demo/surface :preview
                   :demo/docs "showcase/card-default/README.md"
                   :demo/tags ["card" "default"]
                   :demo/theme :light
                   :demo/viewport {:viewport/width 720 :viewport/height 480}
                   :demo/default true}]}
`;

test("strict EDN reader accepts data and rejects executable forms", () => {
  const value = readEdnData('{:title "Hello" :items [1 true nil :calm]}');
  assert.equal(value.title, "Hello");
  assert.deepEqual(value.items.slice(0, 3), [1, true, null]);
  assert.equal(value.items[3] instanceof EdnKeyword, true);
  assert.equal(value.items[3].name, "calm");
  assert.throws(() => readEdnData("(+ 1 2)"), /Lists are not allowed/);
  assert.throws(() => readEdnData("{:value dangerous-symbol}"), /Symbols are not allowed/);
  assert.throws(() => readEdnData("'{:a 1}"), /Quoted forms are not allowed/);
  assert.throws(() => readEdnData("{:a 1 :a 2}"), /Duplicate EDN map key/);
  assert.throws(() => readEdnData("{:a [1 2}"), EdnDataError);
});

test("normalizes a package Showcase with views, states and runnable demos", () => {
  const showcase = parseShowcaseManifest(VALID, {
    expectedPackage: "hara/example",
    expectedVersion: "0.1.0",
  });
  assert.equal(showcase.package, "hara/example");
  assert.equal(showcase.version, "0.1.0");
  assert.deepEqual(showcase.views.map((view) => view.id), ["card"]);
  assert.deepEqual(showcase.states[0].value, { title: "Hello", tone: ":calm" });
  assert.equal(showcase.demos[0].view, "card");
  assert.equal(showcase.demos[0].state, "default");
  const url = new URL(showcase.demos[0].playgroundUrl);
  assert.equal(url.origin, "https://playground.hara-lang.org");
  assert.equal(url.searchParams.get("repo"), "hara-lang/example");
  assert.equal(url.searchParams.get("branch"), "main");
  assert.equal(url.searchParams.get("commit"), COMMIT);
  assert.equal(url.searchParams.get("path"), "examples/showcase/card-default");
  assert.equal(url.searchParams.get("presentation"), "showcase");
  assert.equal(url.searchParams.get("surface"), "preview");
  assert.equal(url.searchParams.get("theme"), "light");
});

test("Showcase schema rejects hidden executable fields, traversal and broken references", () => {
  assert.throws(
    () => parseShowcaseManifest(VALID.replace(':demo/default true', ':demo/default true :demo/expression "(destroy)"')),
    /unsupported field :demo\/expression/,
  );
  assert.throws(
    () => parseShowcaseManifest(VALID.replace('"showcase/card-default"', '"../secret"')),
    /normalized relative path/,
  );
  assert.throws(
    () => parseShowcaseManifest(VALID.replace(':demo/view :card', ':demo/view :missing')),
    /references missing view missing/,
  );
  assert.throws(
    () => parseShowcaseManifest(VALID, { expectedPackage: "hara/other" }),
    /does not match registry path/,
  );
  assert.throws(
    () => parseShowcaseManifest(VALID.replace(COMMIT, "A".repeat(40))),
    /lowercase 40-character SHA/,
  );
});

test("Gallery builder requires finalized release siblings and emits a deterministic index", async () => {
  const root = await mkdtemp(join(tmpdir(), "hara-gallery-"));
  try {
    const directory = join(root, "packages", "hara", "example");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "0.1.0.edn"), '{:release/package :hara/example :release/version "0.1.0"}\n');
    await writeFile(join(directory, "0.1.0.showcase.edn"), VALID);
    const index = await buildGalleryIndex({ root });
    assert.equal(index.format, "0.0.0-alpha");
    assert.equal(index.registry, "hara");
    assert.equal(index.packages.length, 1);
    assert.equal(index.packages[0].id, "hara/example");
    assert.equal(index.packages[0].versions[0].registryPath, "packages/hara/example/0.1.0.showcase.edn");
    assert.match(galleryIndexJson(index), /"Default card"/);

    await rm(join(directory, "0.1.0.edn"));
    await assert.rejects(() => buildGalleryIndex({ root }), /requires sibling finalized release record/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the committed Gallery index is generated from registry sidecars", async () => {
  const root = new URL("..", import.meta.url);
  const index = await buildGalleryIndex({ root: root.pathname });
  const committed = await readFile(new URL("../site/gallery.json", import.meta.url), "utf8");
  assert.equal(committed, galleryIndexJson(index));
});
