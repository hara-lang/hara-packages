import assert from "node:assert/strict";
import test from "node:test";
import { preflightGalleryIndex, preflightShowcase } from "../src/showcase-preflight.mjs";

const COMMIT = "a".repeat(40);
const source = {
  repository: "hara-lang/example",
  commit: COMMIT,
  branch: "main",
  root: "examples",
};

function showcase(overrides = {}) {
  return {
    package: "hara/example",
    version: "0.1.0",
    source,
    views: [{ id: "card", source: "src/example/card.hal", docs: "docs/card.md" }],
    states: [{ id: "default", file: "showcase/states/default.edn" }],
    demos: [{
      id: "card/default",
      view: "card",
      state: "default",
      project: "showcase/card-default",
      surface: "document",
      docs: "showcase/card-default/README.md",
    }],
    ...overrides,
  };
}

const entries = [
  { path: "examples", type: "tree" },
  { path: "examples/src", type: "tree" },
  { path: "examples/src/example", type: "tree" },
  { path: "examples/src/example/card.hal", type: "blob", size: 80 },
  { path: "examples/docs", type: "tree" },
  { path: "examples/docs/card.md", type: "blob", size: 80 },
  { path: "examples/showcase", type: "tree" },
  { path: "examples/showcase/states", type: "tree" },
  { path: "examples/showcase/states/default.edn", type: "blob", size: 80 },
  { path: "examples/showcase/card-default", type: "tree" },
  { path: "examples/showcase/card-default/project.edn", type: "blob", size: 80 },
  { path: "examples/showcase/card-default/workspace.edn", type: "blob", size: 800 },
  { path: "examples/showcase/card-default/README.md", type: "blob", size: 80 },
];

function response(body, { status = 200, text = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => text ? String(body) : JSON.stringify(body),
  };
}

function fixture({ tree = { sha: "tree-sha", truncated: false, tree: entries }, workspace = null, state = null } = {}) {
  const calls = [];
  const workspaceValue = workspace || {
    "hara/type": ":workspace",
    "workspace/selection": { "surface/id": ":document" },
    "workspace/areas": [{
      "area/presentation": { "presentation/surface": ":document" },
    }],
  };
  const stateValue = state || { title: "Hello" };
  const workspaceBody = typeof workspaceValue === "string" ? workspaceValue : JSON.stringify(workspaceValue);
  const stateBody = typeof stateValue === "string" ? stateValue : JSON.stringify(stateValue);
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/git/trees/")) return response(tree);
    if (String(url).endsWith("/examples/showcase/card-default/workspace.edn")) {
      return response(workspaceBody, { text: true });
    }
    if (String(url).endsWith("/examples/showcase/states/default.edn")) {
      return response(stateBody, { text: true });
    }
    return response("not found", { status: 404, text: true });
  };
  return { calls, fetchImpl };
}

const reader = (value) => JSON.parse(value);

test("preflights every declared source path at the exact immutable commit", async () => {
  const { calls, fetchImpl } = fixture();
  const evidence = await preflightShowcase(showcase(), {
    fetchImpl,
    apiOrigin: "https://api.example",
    rawOrigin: "https://raw.example",
    workspaceReader: reader,
    stateReader: reader,
    tokenValue: "token",
  });
  assert.equal(evidence.source.commit, COMMIT);
  assert.equal(evidence.source.tree, "tree-sha");
  assert.deepEqual(evidence.projects[0].surfaces.includes("document"), true);
  assert.deepEqual(evidence.states, [{
    id: "default",
    path: "examples/showcase/states/default.edn",
  }]);
  assert.equal(calls.some(({ url }) => url.includes("/branches/")), false);
  assert.equal(calls[0].url, `https://api.example/repos/hara-lang/example/git/trees/${COMMIT}?recursive=1`);
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
  assert.equal(calls.some(({ url }) => url.endsWith("/examples/showcase/card-default/workspace.edn")), true);
  assert.equal(calls.some(({ url }) => url.endsWith("/examples/showcase/states/default.edn")), true);
});

test("uses the registry data-only EDN reader for Workspace and state fixtures", async () => {
  const { fetchImpl } = fixture({
    workspace: `{:hara/type :workspace
                 :workspace/selection {:surface/id :document}
                 :workspace/areas
                 [{:area/presentation {:presentation/surface :document}}]}`,
    state: `{:title "Hello" :items [1 2 3] :tone :calm}`,
  });
  const evidence = await preflightShowcase(showcase(), { fetchImpl });
  assert.equal(evidence.projects[0].surfaces.includes("document"), true);
  assert.deepEqual(evidence.states, [{
    id: "default",
    path: "examples/showcase/states/default.edn",
  }]);
});

test("fails closed for missing paths, truncated trees and undeclared surfaces", async () => {
  const missing = fixture({ tree: { sha: "tree", truncated: false, tree: entries.filter((entry) => !entry.path.endsWith("card.hal")) } });
  await assert.rejects(
    () => preflightShowcase(showcase(), { fetchImpl: missing.fetchImpl, workspaceReader: reader, stateReader: reader }),
    /source path is missing.*card\.hal/,
  );

  const truncated = fixture({ tree: { sha: "tree", truncated: true, tree: entries } });
  await assert.rejects(
    () => preflightShowcase(showcase(), { fetchImpl: truncated.fetchImpl, workspaceReader: reader, stateReader: reader }),
    /source tree is truncated/,
  );

  const undeclared = fixture({ workspace: { "hara/type": ":workspace" } });
  await assert.rejects(
    () => preflightShowcase(showcase(), { fetchImpl: undeclared.fetchImpl, workspaceReader: reader, stateReader: reader }),
    /selects undeclared surface document/,
  );
});

test("requires complete projects, data-only state files and Workspace manifests", async () => {
  const noProjectDescriptor = fixture({ tree: { sha: "tree", truncated: false, tree: entries.filter((entry) => !entry.path.endsWith("project.edn")) } });
  await assert.rejects(
    () => preflightShowcase(showcase(), { fetchImpl: noProjectDescriptor.fetchImpl, workspaceReader: reader, stateReader: reader }),
    /project\.edn/,
  );

  await assert.rejects(
    () => preflightShowcase(showcase({ states: [{ id: "default", file: "showcase/states/default.json" }] }), {
      fetchImpl: fixture().fetchImpl,
      workspaceReader: reader,
      stateReader: reader,
    }),
    /state file must use the \.edn extension/,
  );

  const wrongWorkspace = fixture({ workspace: { "hara/type": ":document" } });
  await assert.rejects(
    () => preflightShowcase(showcase(), { fetchImpl: wrongWorkspace.fetchImpl, workspaceReader: reader, stateReader: reader }),
    /must declare :hara\/type :workspace/,
  );

  const invalidState = fixture({ state: { not: "used" } });
  await assert.rejects(
    () => preflightShowcase(showcase(), {
      fetchImpl: invalidState.fetchImpl,
      workspaceReader: reader,
      stateReader: () => { throw new Error("Lists are not allowed"); },
    }),
    /state file is not valid data.*Lists are not allowed/,
  );
});

test("shares immutable source trees and raw files across package versions", async () => {
  const { calls, fetchImpl } = fixture();
  const index = {
    registry: "hara",
    packages: [{
      id: "hara/example",
      versions: [showcase(), showcase({ version: "0.2.0" })],
    }],
  };
  const evidence = await preflightGalleryIndex(index, {
    fetchImpl,
    workspaceReader: reader,
    stateReader: reader,
  });
  assert.equal(evidence.sources, 1);
  assert.equal(evidence.packages[0].versions.length, 2);
  assert.equal(calls.filter(({ url }) => url.includes("/git/trees/")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("workspace.edn")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("default.edn")).length, 1);
});
