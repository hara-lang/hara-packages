#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateGalleryIndex } from "../src/gallery.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
try {
  const result = await generateGalleryIndex({ root, check });
  const count = result.index.packages.reduce((total, entry) => total + entry.versions.length, 0);
  console.log(`${check ? "Verified" : "Generated"} site/gallery.json with ${count} Showcase release${count === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
