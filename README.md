# Hara package registry

This is the reviewed Git registry for Hara packages. It records immutable,
signed package releases; HARP archives themselves are GitHub Release assets on
their source repositories.

`packages.hara-lang.org` is generated from this repository. Clients resolve
against a pinned Git commit and do not treat the website as authoritative.

## Shared GitHub identity

The Packages website uses the common account control served by
`id.hara-lang.org`. A person who signs in through Identity sees the same stable
GitHub account on www, Specs, Packages, and Identity. Packages does not own an
OAuth client, receive the OAuth client secret, retain GitHub provider tokens, or
sign an independent browser session.

The shared website session identifies the GitHub account operating the UI. It
does not by itself authorize publication. Package publication still requires
publisher-key possession, an applicable namespace grant, a signed publication
intent, registry validation, and review.

## Layout

- `registry.edn` — registry metadata and schema version.
- `packages/<owner>/<name>/<version>.edn` — immutable finalized releases.
- `packages/<owner>/<name>/<version>.showcase.edn` — optional reviewed views,
  named states and runnable demos for that exact release.
- `requests/<owner>/<name>/<version>.edn` — signed publication requests.
- `requests/candidates/index.json` — deterministic, explicitly unverified
  candidate projection used during review.
- `src/` — strict EDN, publication, Showcase, immutable preflight and Gallery
  validation.
- `site/` — generated/static package browser deployed through Netlify.

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
    + signed publication request
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
capability grants. Packages without a Showcase remain valid and installable.
See [`docs/showcase-format.md`](docs/showcase-format.md) and
[`docs/publication-requests.md`](docs/publication-requests.md).

## Publication lifecycle

1. A source tag produces a signed publisher intent, archive digest and optional
   package-local `showcase.edn`.
2. A request identifies the immutable source commit, package root, archive,
   exported namespaces and publisher evidence.
3. Registry CI materializes an explicitly unverified candidate, validates the
   optional Showcase and preflights all referenced files, projects and surfaces
   against that exact commit.
4. Review and protected jobs verify the namespace grant, publisher signatures,
   reproducible archive checksum and release upload.
5. A registry signer creates the final attestation. Only then are the immutable
   release record and optional normalized Showcase sidecar committed and exposed
   through the Gallery.
