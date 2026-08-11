import assert from "node:assert/strict";
import test from "node:test";
import { parseShowcaseAuthoringManifest } from "../src/showcase-authoring.mjs";

const COMMIT = "a".repeat(40);
const AUTHORING = `
{:hara/type :showcase
 :showcase/format \"0.0.0-alpha\"
 :showcase/package :greenways/hodos-2d
 :showcase/version "0.1.0"
 :showcase/title "Hodos 2D"
 :showcase/summary "Document and graph Workspace models."
 :showcase/views
 [{:view/id :document
   :view/title "Document"
   :view/source "src/gw/hodos/two_d/document.hal"
   :view/docs "README.md"}]
 :showcase/states
 [{:state/id :document/default
   :state/title "Default document"
   :state/file "showcase/states/document-default.edn"}]
 :showcase/demos
 [{:demo/id :document/default
   :demo/title "Inspectable document"
   :demo/view :document
   :demo/state :document/default
   :demo/project "showcase/document"
   :demo/surface :document
   :demo/docs "showcase/document/README.md"
   :demo/default true}]}
`;

const source = {
  repository: "greenways-ai/hodos",
  branch: "main",
  commit: COMMIT,
  root: "packages/2d",
};

test("materializes a package-local Showcase with immutable publication source", () => {
  const showcase = parseShowcaseAuthoringManifest(AUTHORING, {
    source,
    expectedPackage: "greenways/hodos-2d",
    expectedVersion: "0.1.0",
  });
  assert.deepEqual(showcase.source, source);
  assert.equal(showcase.demos[0].project, "showcase/document");
  const url = new URL(showcase.demos[0].playgroundUrl);
  assert.equal(url.searchParams.get("repo"), "greenways-ai/hodos");
  assert.equal(url.searchParams.get("commit"), COMMIT);
  assert.equal(url.searchParams.get("path"), "packages/2d/showcase/document");
  assert.equal(url.searchParams.get("surface"), "document");
});

test("source-local Showcases cannot override publication identity", () => {
  const injected = AUTHORING.replace(
    ":showcase/views",
    `:showcase/source {:source/repository "attacker/repo" :source/commit "${"b".repeat(40)}"}\n :showcase/views`,
  );
  assert.throws(
    () => parseShowcaseAuthoringManifest(injected, { source }),
    /unsupported field :showcase\/source/,
  );
  assert.throws(
    () => parseShowcaseAuthoringManifest(AUTHORING),
    /requires an immutable publication source/,
  );
});

test("authoring identity still matches the publication coordinate", () => {
  assert.throws(
    () => parseShowcaseAuthoringManifest(AUTHORING, {
      source,
      expectedPackage: "greenways/hodos-2d-ui",
    }),
    /does not match registry path/,
  );
  assert.throws(
    () => parseShowcaseAuthoringManifest(AUTHORING, {
      source: { ...source, commit: "main" },
    }),
    /lowercase 40-character SHA/,
  );
});
