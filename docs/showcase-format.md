# Hara Package Showcase format 1

A finalized Hara package may publish a reviewed Showcase sidecar beside its
release record:

```text
packages/<owner>/<name>/<version>.edn
packages/<owner>/<name>/<version>.showcase.edn
```

The release record remains the package authority. The optional sidecar is a
closed declarative index of the package's visible views, named states and
runnable demos. Registry validation rejects executable forms, hidden fields,
path traversal, broken references and mutable source identities.

## Finalized registry example

```clojure
{:hara/type :showcase
 :showcase/format "0.0.0-alpha"
 :showcase/package :hara/example
 :showcase/version "0.1.0"
 :showcase/title "Example UI"
 :showcase/summary "Views and states published with the package."

 :showcase/source
 {:source/repository "hara-lang/example"
  :source/branch "main"
  :source/commit "0123456789abcdef0123456789abcdef01234567"
  :source/root "packages/example"}

 :showcase/views
 [{:view/id :card
   :view/title "Card"
   :view/summary "The package card surface."
   :view/source "src/example/card.hal"
   :view/docs "README.md"}]

 :showcase/states
 [{:state/id :default
   :state/title "Default"
   :state/file "showcase/states/default.edn"
   :state/value {:title "Hello" :tone :calm}}]

 :showcase/demos
 [{:demo/id :card/default
   :demo/title "Default card"
   :demo/view :card
   :demo/state :default
   :demo/project "showcase/card-default"
   :demo/surface :preview
   :demo/docs "showcase/card-default/README.md"
   :demo/tags ["card" "default"]
   :demo/theme :light
   :demo/viewport {:viewport/width 720
                   :viewport/height 480}
   :demo/default true}]}
```

## Package-local authoring form

A package repository may keep `showcase.edn` beside its `project.edn`. This
source-local form uses the same fields except `:showcase/source`:

```clojure
{:hara/type :showcase
 :showcase/format "0.0.0-alpha"
 :showcase/package :hara/example
 :showcase/version "0.1.0"
 :showcase/title "Example UI"
 :showcase/views [...]
 :showcase/states [...]
 :showcase/demos [...]}
```

The omission is required rather than optional. Git commits are
content-addressed, so a file cannot contain the hash of the same commit that
contains it. A signed publication request supplies the exact repository,
commit, branch and package root. Candidate preparation injects those values and
then runs the normal finalized schema and immutable source preflight.

The source-local manifest cannot provide or override `:showcase/source`. This
keeps mutable branches and package-authored commit claims out of the authority
path.

Paths inside views, states and demos are relative to the publication request's
`:source/root`. A common package layout is:

```text
project.edn
README.md
showcase.edn
src/...
showcase/
  states/default.edn
  card-default/
    project.edn
    workspace.edn
    README.md
    src/main.hal
```

See [`publication-requests.md`](publication-requests.md) for materialization and
candidate review.

## Model

A **view** is a named conceptual surface with optional source and documentation
links. A **state** is a named fixture represented by bounded EDN data, a
reviewed fixture file, or both. A **demo** is a complete Hara project that
combines a view and optional state and selects one surface declared by that
project's `workspace.edn`.

This deliberately avoids injecting source or state through the browser
protocol. The runnable unit is a complete project at an immutable Git commit:

```text
registry Showcase sidecar
    -> source repository + exact commit
    -> demo project path + declared surface
    -> Playground Showcase Host v1
    -> Hara runtime + Hodos rendering
```

## Closed schema

Format 1 accepts only the documented fields. In particular, Showcase records
cannot contain snippets, expressions, JavaScript, component constructors,
capability grants or arbitrary commands. EDN lists, quoted forms and symbols
are rejected before schema validation.

All paths are normalized repository-relative paths. Absolute paths,
backslashes, empty segments, `.` and `..` are rejected. Finalized source commits
must be lowercase 40-character Git SHAs.

## Publication preflight

`npm run showcase:preflight` verifies finalized sidecars against their exact
source commits before validation or deployment succeeds. Publication candidate
preparation performs the same preflight immediately after materializing a
source-local manifest.

The preflight performs one recursive Git tree request per distinct repository
and commit, never resolves a branch, and fails closed when the source tree is
missing, malformed or truncated. It proves that:

- every declared view source and documentation file exists;
- every named state file exists, uses `.edn`, stays within the bounded data
  limit and passes the same data-only EDN reader as registry metadata;
- every demo path is a complete project containing `project.edn` and
  `workspace.edn`;
- each `workspace.edn` declares `:hara/type :workspace`;
- each demo surface is either a stable Playground surface or a surface declared
  by the project's Workspace presentation data;
- demo documentation exists at the immutable commit.

CI and deployment use a read-only GitHub token for tree metadata. Raw project
and fixture files are fetched from their exact public commit without sending
that token to the content origin. Repeated versions sharing one source commit
reuse the same tree and file evidence during a validation run.

## Generated Gallery index

`npm run gallery:build` validates every finalized sidecar and writes
`site/gallery.json`. `npm run gallery:check` fails when the committed projection
is stale. The website consumes this generated JSON, but Git release records and
sidecars remain authoritative.

Packages without a Showcase sidecar remain valid and installable.
