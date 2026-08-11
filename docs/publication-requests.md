# Hara package publication request format 1

A publication request proposes one immutable package release for registry review.
It is evidence, not a finalized release or registry attestation.

```text
requests/<owner>/<name>/<version>.edn
```

## Example

```clojure
{:hara/type :package-publication-request
 :request/format "0.0.0-alpha"

 :request/package
 {:package/name :greenways/hodos-2d
  :package/version "0.1.0"
  :package/namespaces
  [:gw.hodos.two-d.document
   :gw.hodos.two-d.graph]}

 :request/source
 {:source/repository "greenways-ai/hodos"
  :source/branch "main"
  :source/commit "0123456789abcdef0123456789abcdef01234567"
  :source/tag "hodos-2d-v0.1.0"
  :source/workflow-run 123456789
  :source/root "packages/2d"}

 :request/artifact
 {:artifact/archive "greenways-hodos-2d.harp"
  :artifact/sha256 "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  :artifact/signature "ed25519:<detached-signature>"}

 :request/publisher
 {:publisher/key-id "did:key:<publisher-key>"
  :publisher/signature-algorithm :ed25519}

 :request/reproducibility
 {:repro/build-command "hara package build"
  :repro/toolchain ["hara@0.1.0" "node@22"]}

 :request/intent
 "Publish greenways/hodos-2d 0.1.0 from the exact reviewed commit."

 :request/showcase
 {:showcase/path "showcase.edn"}}
```

## Closed request boundary

Format 1 accepts only the documented fields. Validation rejects executable EDN
forms, unknown fields, malformed coordinates, duplicate namespaces, mutable or
malformed commits, path traversal, non-HARP archives, invalid SHA-256 values and
unsupported signature algorithms.

The request path, `:package/name` and `:package/version` must agree.
`:source/branch`, `:source/tag` and `:source/workflow-run` are supporting
evidence; `:source/commit` is authoritative.

## Package-local Showcase authoring

A source package can keep this beside `project.edn`:

```clojure
{:hara/type :showcase
 :showcase/format "0.0.0-alpha"
 :showcase/package :greenways/hodos-2d
 :showcase/version "0.1.0"
 :showcase/title "Hodos 2D"
 :showcase/views [...]
 :showcase/states [...]
 :showcase/demos [...]}
```

The source-local form deliberately has no `:showcase/source`. Git commits are
content-addressed, so a file cannot contain the hash of the same commit that
contains it. Candidate preparation injects source identity from the publication
request:

```text
:source/repository
:source/branch
:source/commit
:source/root
```

The resulting finalized manifest passes the normal Showcase schema and
immutable source preflight. A source-local manifest cannot override that
identity.

## Candidate projection

```text
npm run requests:build
npm run requests:check
```

The builder scans request files and writes:

```text
requests/candidates/index.json
```

Each candidate contains deterministic request and candidate digests, the
proposed release target, optional finalized Showcase target, preflight evidence
and an explicit authority ledger.

Candidate status is always `candidate`. The following remain unverified:

```text
artifact rebuild and checksum
publisher archive signature
publisher intent signature
publisher namespace grant
```

The following remain absent until protected publication succeeds:

```text
registry attestation
source release upload
finalized registry record
```

No candidate is installable and no candidate is shown in the public Package
Gallery.

## Showcase preflight

When a request names `showcase.edn`, candidate preparation:

1. fetches the authoring manifest from the exact source commit;
2. injects the immutable publication source;
3. validates the closed finalized Showcase schema;
4. verifies every source, documentation, state and demo path;
5. requires `project.edn` and `workspace.edn` for each demo;
6. parses state files as data-only EDN;
7. proves every advertised demo surface is declared by its Workspace.

Only the Git tree API receives the read-only CI token. Raw public source files
are fetched without forwarding credentials.
