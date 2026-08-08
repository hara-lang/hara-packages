#!/usr/bin/env node
import { buildGalleryIndex } from "../src/gallery.mjs";
import { preflightGalleryIndex } from "../src/showcase-preflight.mjs";

try {
  const index = await buildGalleryIndex({ root: process.cwd() });
  const evidence = await preflightGalleryIndex(index);
  const versions = evidence.packages.reduce((count, record) => count + record.versions.length, 0);
  console.log(`Verified ${versions} package Showcase${versions === 1 ? "" : "s"} across ${evidence.sources} immutable source tree${evidence.sources === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
