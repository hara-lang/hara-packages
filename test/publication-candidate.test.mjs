import assert from "node:assert/strict";
import test from "node:test";
import {
  preparePublicationCandidate,
  rawPublicationSourceUrl,
  stableJson,
} from "../src/publication-candidate.mjs";

const COMMIT = "a".repeat(40);
const SHOWCASE = `
{:hara/type :showcase
 :showcase/format 1
 :showcase/package :greenways/hodos-2d
 :showcase/version "0.1.0"
 :showcase/title "Hodos 2D"
 :showcase/views [{:view/id :document
                   :view/title "Document"
                   :view/source "src/gw/hodos/two_d/document.hal"}]
 :showcase/states [{:state/id :default
                    :state/title "Default"
                    :state/file "showcase/states/default.edn"}]
 :showcase/demos [{:demo/id :document/default
                   :demo/title "Document"
                   :demo/view :document
                   :demo/state :default
                   :demo/project "showcase/document"
                   :demo/surface :document
                   :demo/default true}]}
`;

function request(overrides = {}) {
  return {
    format: 1,
    requestPath: "requests/greenways/hodos-2d/0.1.0.edn",
    package: {
      name: "greenways/hodos-2d",
      version: "0.1.0",
      namespaces: ["gw.hodos.two-d.document", "gw.hodos.two-d.graph"],
    },
    source: {
      repository: "greenways-ai/hodos",
      branch: "main",
      commit: COMMIT,
      tag: "hodos-2d-v0.1.0",
      workflowRun: 42,
      root: "packages/2d",
    },
    artifact: {
      archive: "greenways-hodos-2d.harp",
      sha256: "b".repeat(64),
      signature: "ed25519:archive-signature",
    },
    publisher: {
      keyId: "did:key:zPublisher",
      signatureAlgorithm: "ed25519",
    },
    reproducibility: {
      buildCommand: "hara package build",
      toolchain: ["hara@0.1.0"],
    },
    intent: "Publish greenways/hodos-2d 0.1.0 from the reviewed commit.",
    showcase: { path: "showcase.edn" },
    ...overrides,
  };
}

function response(body, { status = 200, length = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" && length != null ? String(length) : null;
      },
    },
    text: async () => body,
  };
}

test("materializes and preflights a source-local Showcase at the request commit", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return response(SHOWCASE);
  };
  const preflightCalls = [];
  const preflight = async (manifest, options) => {
    preflightCalls.push({ manifest, options });
    return { source: manifest.source, projects: [{ id: "document/default" }] };
  };

  const candidate = await preparePublicationCandidate(request(), {
    fetchImpl,
    preflight,
    rawOrigin: "https://raw.example",
    apiOrigin: "https://api.example",
    tokenValue: "read-token",
  });

  assert.equal(
    calls[0].url,
    `https://raw.example/greenways-ai/hodos/${COMMIT}/packages/2d/showcase.edn`,
  );
  assert.deepEqual(calls[0].options.headers, { Accept: "text/plain" });
  assert.deepEqual(preflightCalls[0].manifest.source, {
    repository: "greenways-ai/hodos",
    branch: "main",
    commit: COMMIT,
    root: "packages/2d",
  });
  assert.equal(preflightCalls[0].options.tokenValue, "read-token");
  assert.equal(candidate.release.target, "packages/greenways/hodos-2d/0.1.0.edn");
  assert.equal(candidate.release.record["source/root"], "packages/2d");
  assert.equal(candidate.showcase.target, "packages/greenways/hodos-2d/0.1.0.showcase.edn");
  assert.equal(candidate.showcase.sourcePath, "packages/2d/showcase.edn");
  assert.equal(candidate.showcase.manifest.source.commit, COMMIT);
  assert.match(candidate.showcase.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(candidate.candidateSha256, /^[0-9a-f]{64}$/);
  assert.equal(candidate.status, "candidate");
  assert.deepEqual(candidate.authorities.missing, [
    "registry/attestation",
    "source/release-upload",
    "registry/finalized-record",
  ]);
});

test("candidate preparation is deterministic and optional Showcases make no request", async () => {
  const fetchImpl = async () => response(SHOWCASE);
  const preflight = async () => ({ ok: true });
  const first = await preparePublicationCandidate(request(), { fetchImpl, preflight });
  const second = await preparePublicationCandidate(request(), { fetchImpl, preflight });
  assert.equal(stableJson(first), stableJson(second));

  let called = false;
  const withoutShowcase = await preparePublicationCandidate(
    request({ showcase: undefined }),
    { fetchImpl: async () => { called = true; throw new Error("must not fetch"); } },
  );
  assert.equal(called, false);
  assert.equal(withoutShowcase.showcase, undefined);
});

test("Showcase fetches fail closed and never receive the GitHub API token", async () => {
  assert.equal(
    rawPublicationSourceUrl(request().source, "packages/2d/showcase.edn", "https://raw.example"),
    `https://raw.example/greenways-ai/hodos/${COMMIT}/packages/2d/showcase.edn`,
  );

  await assert.rejects(
    () => preparePublicationCandidate(request(), {
      fetchImpl: async () => response("missing", { status: 404 }),
      preflight: async () => ({ ok: true }),
    }),
    /Publication Showcase request failed \(404\)/,
  );

  await assert.rejects(
    () => preparePublicationCandidate(request(), {
      fetchImpl: async () => response(SHOWCASE, { length: 1_000_001 }),
      preflight: async () => ({ ok: true }),
    }),
    /exceeds the 1000000-byte limit/,
  );
});
