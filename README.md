# Hara package registry

This is the reviewed registry for Hara packages. It records immutable, signed
package releases; HARP archives themselves are GitHub Release assets on their
source repositories.

`packages.hara-lang.org` reads its registry EDN from the public OCI artifact at
`ghcr.io/hara-lang/hara-packages`. The production CI workflow tags the artifact
with `main` and the source `sha-<commit>`, then anonymously verifies its public
manifest, provenance annotations and registry-layer digest before deploying
Netlify. The endpoint verifies the same provenance and layer digest before
serving EDN. A commit-pinned request is immutable; the `main` request is
revalidated so it can advance with the GitHub Package. The website remains a
convenience UI, not the registry authority.

## Shared GitHub identity

The Packages website uses the common account control served by
`id.hara-lang.org`. A person who signs in through Identity sees the same stable
GitHub account on www, Specs, Packages, and Identity. Packages does not own an
OAuth client, receive the OAuth client secret, retain GitHub provider tokens, or
sign an independent browser session.

The shared website session identifies the GitHub account operating the UI. The
draft Publishing contract then authorizes repository access through a narrowly
scoped GitHub App and binds publication to an exact repository commit whose
`project.edn` declares the release. Untrusted build jobs reproduce that exact
project without protected credentials; protected finalization revalidates the
result and proposes the accepted registry record.

The current implementation also carries publisher-key, detached-signature and
namespace-grant evidence in publication requests. These are implementation
controls and transitional evidence, not additional public requirements of the
draft Publishing specification. See [`docs/publishing-conformance.md`](docs/publishing-conformance.md).

Native clients submit through [`docs/publication-intake.md`](docs/publication-intake.md).
Intake verifies a root-signed publisher grant and a one-time Identity device
authorization before creating a reviewable request receipt; it never accepts a
publisher-uploaded archive.

## Layout

- `registry.edn` — registry metadata and schema version.
- `packages/<owner>/<name>/<version>.edn` — immutable finalized releases.
- `packages/<owner>/<name>/<version>.showcase.edn` — optional reviewed views,
  named states and runnable demos for that exact release.
- `requests/<owner>/<name>/<version>.edn` — publication request/evidence records.
- `requests/candidates/index.json` — deterministic, explicitly unverified
  candidate projection used during review.
- `src/` — strict EDN, publication, Showcase, immutable preflight and Gallery
  validation.
- `site/` — generated/static package browser deployed through Netlify.

The GitHub-Package-pinned `registry.edn` also carries deterministic
`:registry/packages` and `:registry/namespaces` projections. Runtime clients use
those projections to discover locked namespaces without loading them, then
download the selected immutable archive through
`/objects/sha256/<archive-digest>`. Preview and candidate records never enter
either projection.

## Package Showcases

A source package may keep a closed declarative `showcase.edn` beside its
`project.edn`. The source-local file names views, bounded EDN states and complete
Playground demo projects, but deliberately omits `:showcase/source`: a file
cannot contain the hash of the same Git commit that contains the file.

A publication request supplies the exact repository, commit and package root.
Registry candidate preparation fetches `showcase.edn` from that commit, injects
the immutable source identity, validates the finalized form and preflights every
referenced path and Workspace surface.

```text
source package/showcase.edn
    + publication request evidence
    -> immutable source identity injection
    -> finalized Showcase validation
    -> source-tree and Workspace preflight
    -> reviewed release + Showcase sidecar
    -> generated site/gallery.json
    -> packages.hara-lang.org
    -> commit-pinned Playground iframe
```

The Packages origin never executes package code. Runnable demos remain complete
projects hosted by the capability-gated Playground Showcase Host.

`npm run showcase:preflight` verifies finalized Showcases already present in the
registry. `npm run requests:build` materializes deterministic publication
candidates from pending requests, and `npm run requests:check` prevents the
committed candidate index from drifting.

Showcase metadata cannot contain source snippets, expressions, constructors or
capability grants. It is presentation-only and cannot override package identity,
dependencies, build intent, extensions, remote artifacts or publication
authority. Packages without a Showcase remain valid and installable. See
[`docs/showcase-format.md`](docs/showcase-format.md),
[`docs/publication-requests.md`](docs/publication-requests.md), and
[`docs/publishing-conformance.md`](docs/publishing-conformance.md).

## Publication lifecycle

The normative draft flow is:

1. A contributor signs in through GitHub and selects an authorized repository,
   tag and exact commit whose `project.edn` declares the release.
2. Intake records the immutable source identity and portal-attested publication
   intent. Existing publisher/signature/grant fields remain transitional
   implementation evidence while the request schema is reconciled.
3. An untrusted builder resolves the exact `project.edn`, verifies locked inputs
   and produces the deterministic `.harp` without object-store, registry-mutation
   or finalizer-signing credentials.
4. A protected finalizer revalidates source and output bytes, writes immutable
   objects, creates the attestation and proposes the accepted release record.
5. The release becomes authoritative and visible only after the protected
   registry Git change is merged and CI has projected that exact revision to
   the public GitHub Packages artifact.

The exact implementation-to-spec mapping and known gaps are maintained in
[`docs/publishing-conformance.md`](docs/publishing-conformance.md). Changes to
accepted authorization semantics or request/release state transitions require a
specification amendment before they are presented as the public protocol.
