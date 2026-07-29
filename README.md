# Hara package registry

This is the reviewed Git registry for Hara packages. It records immutable,
signed package releases; HARP archives themselves are GitHub Release assets on
their source repositories.

`package.hara-lang.org` is generated from this repository. Clients resolve
against a pinned Git commit and do not treat the website as authoritative.
`api.hara-lang.org` is a read-only discovery/cache interface over this GitHub
repository. It has no publish authority; clients still verify pinned commits,
identity policy and archive digests.

## Layout

- `registry.edn` — registry metadata and schema version.
- `packages/<owner>/<name>/<version>.edn` — immutable finalized releases.
- `requests/` — publication requests awaiting review.
- `site/` — generated/static package browser deployed through GitHub Pages.

## Publication lifecycle

1. A source tag produces a signed publisher intent.
2. A reviewed request identifies that immutable source commit.
3. Registry CI rebuilds the package and verifies the intent.
4. A protected publishing job signs the registry attestation and uploads the
   archive and detached metadata to the source release.
5. The final release record is committed here and appears in the site index.

During bootstrap, protected GitHub governance is the registry attestation
authority. The request and promotion workflows are deliberately split: request
validation receives no credentials, while protected promotion is restricted to
approved Hara-org sources and a future narrowly scoped GitHub App.
