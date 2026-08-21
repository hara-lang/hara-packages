# Publishing conformance matrix

This document maps the current `hara-packages` implementation to the draft Hara
Publishing contract at:

- registry: `hara-lang/hara-specs-registry`
- revision: `64d81ebe5fded2809c6fc4414796a3feddf98a33`
- artifact: `02-platform/000009-publishing/draft/hara-publishing.edn`

The specification is normative. This repository is an implementation and may
contain transitional evidence or additional internal controls that are not part
of the public publishing protocol.

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

Publisher keys, detached signatures and namespace-grant evidence currently
present in request fixtures are implementation evidence. They are not presented
here as additional public requirements. Any decision to make them normative must
first amend the Publishing specification.

## Mapping

| Contract | Current implementation evidence | Status | Required follow-up |
| --- | --- | --- | --- |
| `:hara.publishing.operation/sign-in` | Shared GitHub identity is described in `README.md`; Packages does not own the OAuth secret or provider token. | partial | Prove the portal session/repository authorization path against the GitHub App boundary. |
| `:hara.publishing.operation/submit` | `requests/**` identify package coordinates and immutable source commits; candidate generation is review-only. | partial | Intake must derive package/release/build/extension/remote-artifact intent from exact-commit `project.edn`, not duplicate request fields. |
| `:hara.publishing.operation/build` | Candidate/reproducibility data and archive digests exist. | partial | Demonstrate isolated deterministic `.harp` production and lock verification with no protected credentials. |
| `:hara.publishing.operation/finalize` | Registry attestation and finalized immutable records exist as protected-stage concepts. | partial | Prove revalidation, object conflict handling and protected registry proposal as one finalizer boundary. |
| `:hara.publishing/github-identity` | Shared GitHub identity is implemented for the UI. | partial | Record narrowly scoped GitHub App repository authorization in implementation evidence. |
| `:hara.publishing/project-authority` | Exact source commit/root are already recorded. | gap | Move duplicated package/build/extension/remote-artifact intent to `project.edn` authority; requests become evidence/selection only. |
| `:hara.publishing/exact-source` | `:source/commit` is authoritative; tag/branch/workflow are supporting evidence. | partial | Record repository numeric id and exact `project.edn` digest in accepted intent/attestation evidence. |
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
