#!/usr/bin/env node
import { writePublicationCandidateIndex } from "../src/publication-candidates.mjs";

const check = process.argv.includes("--check");

try {
  const index = await writePublicationCandidateIndex({ check });
  const count = index.candidates.length;
  console.log(`${check ? "Verified" : "Wrote"} ${count} publication candidate${count === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
