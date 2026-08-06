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
- `requests/` — publication requests awaiting review.
- `site/` — generated/static package browser deployed through Netlify.

## Publication lifecycle

1. A source tag produces a signed publisher intent.
2. A reviewed request identifies that immutable source commit.
3. Registry CI rebuilds the package and verifies the intent.
4. A protected publishing job signs the registry attestation and uploads the
   archive and detached metadata to the source release.
5. The final release record is committed here and appears in the site index.
