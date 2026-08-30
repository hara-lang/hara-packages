# Native publication intake

`POST /v1/publications` accepts the canonical JSON envelope emitted by
`hara-native publish`. It is an intake boundary, not an archive upload API.

```json
{
  "intent": "{:intent/format ...}\n",
  "key_id": "hoebat-2026-01",
  "signature": "<Ed25519 signature over the exact intent bytes>",
  "authorization": {
    "payload": {"authorization": "hara-publisher/1", "...": "..."},
    "signature": "<Identity Ed25519 signature>"
  }
}
```

The endpoint fetches the exact root-signed policy revision named by the intent
and rejects a submission unless all of these agree:

1. the publisher key and detached signature;
2. the exact coordinate's scope, stable GitHub subject, and revocation state;
3. the one-time, unexpired Identity authorization and intent digest; and
4. the pinned official identity-root fingerprint.

Accepted submissions create one reviewable GitHub App PR containing an immutable
receipt in `intake/<owner>/<name>/<version>.json`. The receipt is evidence only:
the credential-free builder must produce the archive, and protected finalization
must create the attestation, immutable object, and authoritative release record.
Repeating an authorization nonce is rejected before a second PR can be opened.

## Deployment configuration

Configure these as encrypted Packages-site variables, never in Git:

```text
HARA_OFFICIAL_ROOT_SHA256
HARA_ID_ENDPOINT
HARA_PACKAGES_APP_ID
HARA_PACKAGES_APP_INSTALLATION_ID
HARA_PACKAGES_APP_PRIVATE_KEY
HARA_PACKAGES_REPOSITORY
```

The GitHub App needs only repository contents and pull-request write access to
`hara-lang/hara-packages`; source-repository access is separately constrained
for the build workflow. The Identity service signing public key must be added to
the root-signed policy as `:identity/publish-authorization-key` before this
endpoint will accept production requests.
