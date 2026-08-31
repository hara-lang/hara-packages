# Hara Packages

`hara-lang/hara-packages` is the GitHub-governed publishing boundary for Hara
source packages. The authoritative bytes and metadata are public OCI artifacts
under `ghcr.io/hara-packages`; this repository neither stores package archives
nor accepts archive uploads.

For source repository `owner/repo`, a release publishes the paired immutable
artifacts:

```text
ghcr.io/hara-packages/owner.repo:<version>
ghcr.io/hara-packages/owner.repo.specs:<version>
```

The source artifact is a HARP package. The specs artifact is a separate,
verifiable HARP package containing the optional `spec/` tree and its generated
manifest. A project with no `spec/` directory still publishes an empty specs
companion.

## Publication

`publish-packages.yml` is the only workflow allowed to write to GHCR. A source
tag workflow creates a canonical OIDC/Sigstore-signed receipt PR under
`requests/<owner.repo>/<version>.json`. Pull requests validate the receipt,
source policy, and workflow identity without package credentials. After a
protected merge, the workflow verifies the signed tag, rebuilds both HARP
archives with the pinned Hara Native revision, verifies them, publishes
immutable version and source-commit tags, makes both packages public, and reads
their manifests back.

The protected `hara-packages-publish` environment must provide:

```text
HARA_PACKAGES_GHCR_TOKEN       classic PAT authorized to write hara-packages GHCR packages
HARA_PACKAGES_GHCR_USERNAME    owner of that token
```

Source repositories receive only the GitHub App credential needed to open a
reviewable receipt PR. They never receive a GHCR credential. Add a source to
[`publication-sources.json`](publication-sources.json) through normal review
before it can publish.

## Public API

`packages.hara-lang.org` remains a read-only convenience API:

- `/.well-known/hara-tap.edn`
- `/v1/registry` (GitHub Packages-derived registry format `0.0.1`)
- `/objects/sha256/<digest>` (digest-verified GHCR HARP layer)

It enumerates GitHub Packages and verifies OCI provenance and layer digests on
every uncached resolution. The cache is short-lived acceleration only. Legacy
`registry-commit` requests return a migration error; R2 objects and
`POST /v1/publications` no longer exist.

## Development

```sh
npm install
npm test
npm run validate
```

The Gallery remains a static, presentation-only surface. It does not grant
publication authority or execute package code.
