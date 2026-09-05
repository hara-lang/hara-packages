# Hara Packages

`hara-lang/hara-packages` is the GitHub-governed publishing boundary for Hara
source packages. The authoritative bytes and metadata are public OCI artifacts
under `ghcr.io/hara-packages`; this repository neither stores package archives
nor accepts archive uploads.

For source repository `owner/repo`, a release preserves the paired immutable
root artifacts:

```text
ghcr.io/hara-packages/owner.repo:<version>
ghcr.io/hara-packages/owner.repo.specs:<version>
```

The source artifact is a HARP package. The specs artifact is a separate,
verifiable HARP package containing the optional `spec/` tree and its generated
manifest. A project with no `spec/` directory still publishes an empty specs
companion.

When a source project declares `config/packages.edn`, the protected workflow
also builds its dependency-ordered semantic package graph through the released
companion `hara` executable. Each semantic package is published with a stable
derived image name and an empty-or-owned specs companion, for example:

```text
hara/std.config  -> ghcr.io/hara-packages/hara-lang.hara.packages.hara.std.config:<version>
```

The HARP manifest remains authoritative for the package coordinate, version,
resources, and checksums; the image path is deterministic discovery metadata.
The workflow rejects names outside the reviewed `hara/*` namespace, validates
every HARP before publication, and reads every OCI manifest back afterward.

## Publication

`publish-packages.yml` is the only workflow allowed to write to GHCR. A source
tag workflow creates a canonical OIDC/Sigstore-signed receipt PR under
`requests/<owner.repo>/<version>.json`. Pull requests validate the receipt,
source policy, and workflow identity without package credentials. After a
protected merge, the workflow verifies the signed tag, rebuilds the root,
specs, and semantic HARP graph with the pinned Hara Native revision, verifies
them, publishes immutable version and source-commit tags, makes every package
public, and reads their manifests back.

The protected `hara-packages-publish` environment is the approval boundary.
The workflow uses its ephemeral `GITHUB_TOKEN` with the workflow-level
`packages: write` permission; no long-lived GHCR PAT or package username is
required.

Source repositories receive only the GitHub App credential needed to open a
reviewable receipt PR. They never receive a GHCR credential. Add a source to
[`publication-sources.json`](publication-sources.json) through normal review
before it can publish.

## Administrator setup

- Protect `main` and require the receipt-validation checks before merge.
- Require reviewers for the `hara-packages-publish` environment and permit its
  `GITHUB_TOKEN` to write packages in the `hara-packages` organization.
- Keep the source-receipt App limited to `hara-packages` contents writes; it
  must not receive GHCR package credentials.
- Keep the release-signing public key fingerprint in this workflow aligned
  with the source request workflow. Private signing material stays outside
  repository contents.
- Configure the Netlify site with the optional read-only
  `HARA_GITHUB_PACKAGES_READ_TOKEN` if GitHub Packages API rate limits require
  authenticated catalog reads.

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
