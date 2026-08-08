import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const shell = await readFile(new URL("../site/public-shell.css", import.meta.url), "utf8");
const verifier = await readFile(new URL("../.github/scripts/verify-shared-identity.sh", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("renders the shared Hara identity with a local package fallback", () => {
  assert.match(page, /data-hara-identity/);
  assert.match(page, /data-hara-identity-fallback/);
  assert.match(page, /aria-label="Sign in with GitHub"/);
  assert.match(page, /<meta name="hara-identity-mode" content="popup">/);
  assert.match(page, /https:\/\/id\.hara-lang\.org/);
  assert.match(page, /https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(page, /\/v1\/identity-client\.js/);
  assert.match(page, /location\.hostname.*packages\.testing\.hara-lang\.org/s);
  assert.match(page, /new URL\("\/github\/start", identityOrigin\)/);
  assert.match(page, /signIn\.searchParams\.set\("returnTo", location\.href\)/);
  assert.doesNotMatch(page, /client_secret|access_token|\/auth\/github\/callback/);
});

test("uses the same public shell hierarchy as www.hara-lang.org", () => {
  assert.match(shell, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(shell, /\.header-actions[\s\S]*justify-self: end/);
  assert.match(page, /class="brand-logo"/);
  assert.match(page, /class="brand-product">Packages/);
  assert.match(page, /Benchmarks[\s\S]*Docs[\s\S]*Specs[\s\S]*World/);
  assert.match(page, /https:\/\/world\.hara-lang\.org\//);
  assert.match(page, /data-hara-theme-toggle/);
});

test("gates testing and production Packages deploys on identity contract v1", () => {
  assert.match(verifier, /\.contractVersion == 1/);
  assert.match(verifier, /\.clientVersion == 1/);
  assert.match(verifier, /\.clientEndpoint == \(\$identity \+ "\/v1\/identity-client\.js"\)/);
  assert.match(verifier, /Access-Control-Allow-Origin/);
  assert.match(verifier, /https:\/\/untrusted\.example/);
  assert.match(verifier, /v1\/identity-client\.js/);
  assert.match(workflow, /Verify built shared identity shell/);
  assert.match(workflow, /Verify testing shared identity/);
  assert.match(workflow, /HARA_SITE_ORIGIN: https:\/\/packages\.testing\.hara-lang\.org/);
  assert.match(workflow, /HARA_IDENTITY_ORIGIN: https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(workflow, /Verify production shared identity/);
  assert.match(workflow, /HARA_SITE_ORIGIN: https:\/\/packages\.hara-lang\.org/);
  assert.match(workflow, /HARA_IDENTITY_ORIGIN: https:\/\/id\.hara-lang\.org/);
  assert.match(workflow, /HARA_GITHUB_OAUTH_CLIENT_SECRET\|HARA_AUTH_SESSION_SECRET\|\/auth\/github\/callback/);
});
