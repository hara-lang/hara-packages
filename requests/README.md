# Publication receipts

Each source release contributes exactly two reviewed files:

```text
requests/<owner.repo>/<version>.json
requests/<owner.repo>/<version>.sigstore.json
```

The JSON receipt binds a source repository, signed tag and commit, project and
recipe digests, pinned Hara Native revision, and optional `spec/` Git tree. The
adjacent Sigstore bundle proves that the approved source workflow created the
exact receipt. `publish-packages.yml` rebuilds artifacts from source; receipts
never contain HARP bytes, credentials, or a mutable release record.
