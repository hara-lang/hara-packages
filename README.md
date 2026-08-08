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
- `requests/` — publication requests awaiting review.
- `src/` — strict EDN, Showcase validation, immutable publication preflight and
  Gallery indexing.
- `site/` — generated/static package browser deployed through Netlify.

## Package Showcases

A finalized package may publish a closed declarative Showcase sidecar. It names
views, bounded EDN states and complete commit-pinned demo projects. The Gallery
runs demos through the cross-origin Playground Showcase Host; the Packages
origin never executes package code.

```text
reviewed release + Showcase sidecar
    -> immutable source-tree preflight
    -> generated site/gallery.json
    -> packages.hara-lang.org navigation
    -> commit-pinned playground.hara-lang.org iframe
    -> Hara runtime + Hodos view
```

`npm run showcase:preflight` verifies every declared source, docs, state and
demo path at the exact source commit. It also requires complete demo projects,
parses state fixtures as data-only EDN and proves that each selected surface is
available in the project's `workspace.edn`. Branches are descriptive only and
are never resolved during publication preflight.

Showcase metadata cannot contain source snippets, expressions, constructors or
capability grants. Packages without a Showcase remain valid and installable.
See [`docs/showcase-format.md`](docs/showcase-format.md).

## Publication lifecycle

1. A source tag produces a signed publisher intent.
2. A reviewed request identifies that immutable source commit.
3. Registry CI rebuilds the package, verifies the intent, validates the optional
   `showcase.edn`, and preflights all referenced files and surfaces against that
   exact commit.
4. A protected publishing job signs the registry attestation and uploads the
   archive and detached metadata to the source release.
5. The final release record and optional normalized Showcase sidecar are
   committed here and appear in the site index.
