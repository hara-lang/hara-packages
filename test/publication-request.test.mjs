import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePublicationRequest,
  publicationRequestPath,
} from "../src/publication-request.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);

function request(overrides = "") {
  return `{:hara/type :package-publication-request
 :request/format 1
 :request/package
 {:package/name :hara/example
  :package/version "0.1.0"
  :package/namespaces [:hara.example :hara.example.ui]}
 :request/source
 {:source/repository "hara-lang/example"
  :source/branch "main"
  :source/commit "${COMMIT}"
  :source/tag "v0.1.0"
  :source/workflow-run 1234
  :source/root "packages/example"}
 :request/artifact
 {:artifact/archive "hara-example-0.1.0.harp"
  :artifact/sha256 "${DIGEST}"
  :artifact/signature "publisher-archive-signature"}
 :request/publisher
 {:publisher/key-id "publisher/example"
  :publisher/signature-algorithm :ed25519}
 :request/reproducibility
 {:repro/build-command "hara package build"
  :repro/toolchain ["hara 0.1.0" "jdk 21"]}
 :request/intent "publisher-intent"
 :request/showcase {:showcase/path "showcase.edn"}
 ${overrides}}`;
}

test("normalizes a closed publication request from its canonical path", () => {
  assert.deepEqual(publicationRequestPath("requests/hara/example/0.1.0.edn"), {
    path: "requests/hara/example/0.1.0.edn",
    package: "hara/example",
    version: "0.1.0",
  });
  const value = parsePublicationRequest(request(), {
    expectedPackage: "hara/example",
    expectedVersion: "0.1.0",
    requestPath: "requests/hara/example/0.1.0.edn",
  });
  assert.equal(value.package.name, "hara/example");
  assert.equal(value.package.version, "0.1.0");
  assert.deepEqual(value.package.namespaces, ["hara.example", "hara.example.ui"]);
  assert.equal(value.source.commit, COMMIT);
  assert.equal(value.source.root, "packages/example");
  assert.equal(value.artifact.sha256, DIGEST);
  assert.equal(value.publisher.signatureAlgorithm, "ed25519");
  assert.equal(value.showcase.path, "showcase.edn");
});

test("requires request path, package and version identity to agree", () => {
  assert.throws(
    () => publicationRequestPath("requests/example.edn"),
    /requests\/<owner>\/<name>\/<version>\.edn/,
  );
  assert.throws(
    () => parsePublicationRequest(request(), { expectedPackage: "hara/other" }),
    /does not match request path hara\/other/,
  );
  assert.throws(
    () => parsePublicationRequest(request(), { expectedVersion: "0.2.0" }),
    /does not match request path 0\.2\.0/,
  );
});

test("rejects unsupported fields, executable EDN and traversal", () => {
  assert.throws(
    () => parsePublicationRequest(request(":request/command \"publish-now\"")),
    /unsupported field :request\/command/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace(
      ':request/showcase {:showcase/path "showcase.edn"}',
      ':request/showcase {:showcase/path "../showcase.edn"}',
    )),
    /normalized relative path/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace(
      ':repro/toolchain ["hara 0.1.0" "jdk 21"]',
      ':repro/toolchain [(dangerous)]',
    )),
    /EDN lists are not accepted/,
  );
});

test("rejects mutable identities, incomplete versions and malformed artifacts", () => {
  assert.throws(
    () => parsePublicationRequest(request().replace(COMMIT, "main")),
    /lowercase 40-character SHA/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace('"0.1.0"', '"0.1"')),
    /semantic version/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace("hara-example-0.1.0.harp", "dist/archive.zip")),
    /\.harp release asset filename/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace(DIGEST, "ABC")),
    /64 lowercase hexadecimal/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace(":ed25519", ":rsa")),
    /must be :ed25519/,
  );
});

test("rejects duplicate namespaces and non-positive workflow runs", () => {
  assert.throws(
    () => parsePublicationRequest(request().replace(
      "[:hara.example :hara.example.ui]",
      "[:hara.example :hara.example]",
    )),
    /namespaces must be unique/,
  );
  assert.throws(
    () => parsePublicationRequest(request().replace(":source/workflow-run 1234", ":source/workflow-run 0")),
    /positive integer/,
  );
});
