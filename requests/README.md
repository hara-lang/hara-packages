# Publication requests

A publication request is reviewable evidence for one immutable package version.
It uses this path:

```text
requests/<owner>/<name>/<version>.edn
```

The request names:

- the package coordinate and exported namespaces;
- an exact source repository, commit, package root, tag and workflow run;
- the HARP archive filename, SHA-256 and detached publisher signature;
- the publisher key and signature algorithm;
- the reproducible build command and toolchain;
- the signed publication intent;
- an optional package-local `showcase.edn` path.

Run:

```text
npm run requests:build
npm run requests:check
```

Candidate generation writes `requests/candidates/index.json`. Candidates remain
explicitly unverified: they are not package releases, registry attestations or
authority to upload assets. They exist so review and protected publishing jobs
operate on a deterministic projection of the request.

When `:request/showcase` is present, candidate preparation fetches the
source-local authoring manifest from the exact request commit, injects the
immutable source identity, validates the finalized Showcase schema and runs the
same source-tree and Workspace preflight used for published Gallery entries.

See [`../docs/publication-requests.md`](../docs/publication-requests.md) for the
complete format and authority boundary.
