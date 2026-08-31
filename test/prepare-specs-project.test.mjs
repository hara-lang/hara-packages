import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareSpecsProject } from "../scripts/prepare-specs-project.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hara-specs-project-"));
  await mkdir(join(root, "source/spec/nested"), { recursive: true });
  await writeFile(join(root, "source/spec/nested/example.edn"), "{:example true}\n");
  return root;
}

test("spec project preparation makes a deterministic HARP-ready project from the optional source spec tree", async () => {
  const root = await fixture();
  const first = await prepareSpecsProject({
    sourceRoot: join(root, "source"), outputRoot: join(root, "one"), specsPath: "spec", coordinate: "hara:hara/foundation", version: "0.1.0",
  });
  const second = await prepareSpecsProject({
    sourceRoot: join(root, "source"), outputRoot: join(root, "two"), specsPath: "spec", coordinate: "hara:hara/foundation", version: "0.1.0",
  });
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.manifest.files.map((file) => file.path), ["nested/example.edn"]);
  assert.match(await readFile(join(root, "one/project.edn"), "utf8"), /:project\/id "hara:hara\/foundation\.specs"/);
  assert.equal(await readFile(join(root, "one/spec/nested/example.edn"), "utf8"), "{:example true}\n");
});

test("missing spec trees become valid empty companion projects and symlinks fail closed", async () => {
  const root = await fixture();
  const empty = await prepareSpecsProject({
    sourceRoot: join(root, "source"), outputRoot: join(root, "empty"), specsPath: "absent", coordinate: "hara:hara/foundation", version: "0.1.0",
  });
  assert.deepEqual(empty.manifest.files, []);
  await symlink("nested/example.edn", join(root, "source/spec/link.edn"));
  await assert.rejects(
    prepareSpecsProject({ sourceRoot: join(root, "source"), outputRoot: join(root, "linked"), specsPath: "spec", coordinate: "hara:hara/foundation", version: "0.1.0" }),
    /symbolic links/,
  );
});
