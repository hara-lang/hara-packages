# Publishing conformance matrix

This document maps the current `hara-packages` implementation to the draft Hara
Publishing contract at:

- registry: `hara-lang/hara-specs-registry`
- revision: `64d81ebe5fded2809c6fc4414796a3feddf98a33`
- artifact: `02-platform/000009-publishing/draft/hara-publishing.edn`

The specification is normative. This repository is an implementation and may
contain transitional evidence or additional internal controls that are not part
of the public publishing protocol.

The publisher-key, device-authorization, and exact-`project.edn` controls in
this working tree follow a local amendment to that draft. They are intentionally
not enabled as a production protocol yet: the amendment must first be committed
and merged in `hara-specs-registry`, then this repository must advance
`publishing-authority.json` to the resulting immutable commit and blob. Until
then, the pinned revision above remains the public authority.

## Authority model

The public authorization story is:

1. the portal identifies the contributor through GitHub sign-in;
2. repository authorization is established through a narrowly scoped GitHub App;
3. the contributor selects an exact repository commit whose `project.edn`
   declares package, release, build, extension, capability and remote-artifact
   intent;
4. an untrusted builder reproduces the package without protected credentials;
5. a protected finalizer revalidates inputs and outputs, writes immutable objects,
   and proposes accepted records; and
6. the release becomes authoritative and visible only after the protected
   registry Git change is merged.

The staged implementation verifies a proven publisher key, a root-signed exact
scope/grant, the stable GitHub subject, and one-time Identity authorization
before creating an intake receipt. These controls become normative only when the
linked specification amendment and authority pin are published together.

## Mapping

| Contract | Current implementation evidence | Status | Required follow-up |
| --- | --- | --- | --- |
| `:hara.publishing.operation/sign-in` | Identity owns GitHub OAuth; device confirmation records the stable GitHub subject and Packages owns no OAuth secret. | partial | Deploy the reviewed Identity App configuration and prove the live portal session/repository authorization path. |
| `:hara.publishing.operation/submit` | `POST /v1/publications` verifies the root-signed key grant, exact canonical intent, publisher signature, and one-time Identity authorization before creating an immutable intake receipt PR. | partial | Publish the accompanying specification authority update and deploy the GitHub App configuration. |
| `:hara.publishing.operation/build` | Candidate/reproducibility data and archive digests exist. | partial | Demonstrate isolated deterministic `.harp` production and lock verification with no protected credentials. |
| `:hara.publishing.operation/finalize` | The protected finalizer verifies two byte-identical builds, the signed `project.edn` digest, immutable-object conflicts, and attestation output. | partial | Connect credential-free builder artifacts and the protected registry proposal in a deployed workflow. |
| `:hara.publishing/github-identity` | Identity device authorization binds the numeric GitHub subject; the Packages and Identity GitHub Apps use only their scoped installation tokens. | partial | Configure the production Apps and record their reviewed repository permissions. |
| `:hara.publishing/project-authority` | The canonical publisher intent binds `project.edn` and recipe digests at the tagged commit. | partial | Derive the remaining build/extension/remote-artifact selections in the credential-free builder. |
| `:hara.publishing/exact-source` | The signed intent names source remote, bare-version tag (or declared override), commit, `project.edn` digest, and recipe digest. | partial | Have the protected builder re-read those exact bytes from the remote commit before finalization. |
| `:hara.publishing/credential-separation` | Public docs describe protected jobs but do not yet prove credential absence in untrusted intake/build. | gap | Add a fixture/test asserting object-store write, registry mutation and finalizer signing credentials are unavailable to untrusted jobs. |
| `:hara.publishing/reproducible` | Reproducibility metadata and archive digest checks exist. | partial | Resolve exact `project.edn`, verify `project.lock.edn`, mirror digest-pinned remote inputs and prove byte-identical `.harp` output. |
| `:hara.publishing/accepted-git-only` | Candidates are explicitly unverified and not installable or shown in the Gallery. | aligned | Keep candidate and preview data outside authoritative package projections. |
| `:hara.publishing/git-commit-point` | Registry Git is described as authoritative. | partial | Add an explicit test that Gallery/package projection occurs only after the accepted registry record is committed. |
| `:hara.publishing/idempotent` | Immutable release conflict checks exist. | partial | Add accepted replay and same-coordinate/version different-content fixtures. |

## Existing request format

`docs/publication-requests.md` describes the repository's current request format.
Until the request schema is amended, treat these fields as transitional evidence:

- duplicated `:request/package` namespace/package declarations;
- publisher key and signature evidence;
- namespace-grant evidence;
- build-command/toolchain evidence supplied by the request rather than derived
  from the selected project's canonical inputs.

They may still be validated by the implementation. Their presence does not
change the normative rule that release/package/build/extension/remote-artifact
intent comes from `project.edn` at the selected exact commit.

## Showcase boundary

`showcase.edn` is presentation-only. It may name views, bounded states,
documentation and runnable demos, but it must not alter:

- package identity or version;
- source paths or exported namespaces;
- dependencies;
- capabilities;
- build or extension intent;
- remote-artifact intent; or
- publication authorization.

Candidate preparation may inject immutable source identity into a finalized
Showcase sidecar, but that sidecar remains subordinate to the accepted release
record and exact source commit.

## Change policy

Documentation and provenance corrections can land while this matrix contains
`partial` and `gap` rows. Changes to authorization semantics, accepted request
fields, release-record fields or state transitions require a specification
amendment first. This prevents the implementation and documentation from
silently inventing a second publishing protocol.
