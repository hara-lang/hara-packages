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

## Example

```clojure
{:hara/type :showcase
 :showcase/format 1
 :showcase/package :hara/example
 :showcase/version "0.1.0"
 :showcase/title "Example UI"
 :showcase/summary "Views and states published with the package."

 :showcase/source
 {:source/repository "hara-lang/example"
  :source/branch "main"
  :source/commit "0123456789abcdef0123456789abcdef01234567"
  :source/root "examples"}

 :showcase/views
 [{:view/id :card
   :view/title "Card"
   :view/summary "The package card surface."
   :view/source "src/example/card.hal"
   :view/docs "docs/card.md"}]

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
backslashes, empty segments, `.` and `..` are rejected. Source commits must be
lowercase 40-character Git SHAs.

## Generated Gallery index

`npm run gallery:build` validates every finalized sidecar and writes
`site/gallery.json`. `npm run gallery:check` fails when the committed projection
is stale. The website consumes this generated JSON, but Git release records and
sidecars remain authoritative.

Packages without a Showcase sidecar remain valid and installable.
