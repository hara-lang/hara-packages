#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const siteRoot = resolve(root, "site");
const commit = "a".repeat(40);
let browser = null;
let server = null;

const gallery = {
  format: "0.0.0-alpha",
  registry: "hara",
  packages: [{
    id: "hara/example",
    versions: [{
      format: "0.0.0-alpha",
      package: "hara/example",
      version: "0.1.0",
      title: "Example UI",
      summary: "A reviewed package Showcase.",
      registryPath: "packages/hara/example/0.1.0.showcase.edn",
      source: {
        repository: "hara-lang/example",
        branch: "main",
        commit,
        root: "examples",
      },
      views: [{
        id: "card",
        title: "Card",
        summary: "The exact package card view.",
        source: "src/example/card.hal",
        docs: "docs/card.md",
      }],
      states: [{
        id: "default",
        title: "Default",
        summary: "The reviewed default card fixture.",
        file: "showcase/states/default.edn",
        value: { title: "Hello", tone: ":calm" },
      }],
      demos: [{
        id: "card/default",
        title: "Default <img src=x onerror=alert(1)>",
        summary: "A safe metadata rendering proof.",
        view: "card",
        state: "default",
        project: "showcase/card-default",
        surface: "preview",
        docs: "showcase/card-default/README.md",
        tags: ["card", "default"],
        theme: "light",
        viewport: { width: 720, height: 480 },
        default: true,
        playgroundUrl: "PLACEHOLDER",
      }],
    }],
  }],
};

const mockPlayground = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Mock Hara Showcase</title></head>
<body>
  <main data-mock-showcase>Mock package surface</main>
  <script>
    const surfaces = ["preview", "document", "code"];
    let surface = new URL(location.href).searchParams.get("surface") || "preview";
    if (!surfaces.includes(surface)) surface = "preview";
    const render = () => {
      document.body.dataset.surface = surface;
      document.querySelector("[data-mock-showcase]").textContent = "Mock " + surface + " surface";
    };
    render();
    const ready = () => parent.postMessage({
      type: "hara.showcase/ready",
      version: 1,
      workspaceId: "hara/example",
      commit: "${commit}",
      surfaceId: surface,
      surfaces,
    }, location.origin);
    addEventListener("message", (event) => {
      if (event.source !== parent || event.origin !== location.origin) return;
      const message = event.data;
      if (message?.type !== "hara.showcase/select-surface" || message?.version !== 1) return;
      if (!surfaces.includes(message.surfaceId)) {
        parent.postMessage({
          type: "hara.showcase/selection",
          version: 1,
          ok: false,
          surfaceId: message.surfaceId,
          message: "Undeclared mock surface",
        }, event.origin);
        return;
      }
      surface = message.surfaceId;
      render();
      parent.postMessage({
        type: "hara.showcase/selection",
        version: 1,
        ok: true,
        surfaceId: surface,
      }, event.origin);
    });
    queueMicrotask(ready);
  </script>
</body>
</html>`;

try {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/gallery.json") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(gallery));
        return;
      }
      if (url.pathname === "/mock-playground.html") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(mockPlayground);
        return;
      }
      const target = safeTarget(url.pathname === "/" ? "/index.html" : url.pathname);
      const metadata = await stat(target);
      if (!metadata.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
      response.writeHead(200, {
        "content-type": contentType(target),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(await readFile(target));
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 400, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(error?.message || String(error));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  gallery.packages[0].versions[0].demos[0].playgroundUrl = `${origin}/mock-playground.html?presentation=showcase&surface=preview`;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let identityClientRequests = 0;
  await context.route("https://id.hara-lang.org/v1/identity-client.js", async (route) => {
    identityClientRequests += 1;
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
        "cross-origin-resource-policy": "cross-origin",
      },
      body: `document.querySelectorAll("[data-hara-identity]").forEach((root) => {
        root.dataset.state = "fixture-signed-out";
      });`,
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let content = "not found";
    let status = 404;
    if (path.endsWith("/examples/src/example/card.hal")) {
      status = 200;
      content = "(ns example.card)\n\n(defn card [state]\n  [:article.card (:title state)])\n";
    } else if (path.endsWith("/examples/showcase/states/default.edn")) {
      status = 200;
      content = '{:title "Hello from the reviewed fixture" :tone :calm}\n';
    } else if (path.endsWith("/examples/showcase/card-default/README.md")) {
      status = 200;
      content = "# Default card\n\nThis demo is published beside the exact package source.\n";
    }
    await route.fulfill({
      status,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
      body: content,
    });
  });

  const url = new URL(origin);
  url.searchParams.set("package", "hara/example");
  url.searchParams.set("version", "0.1.0");
  url.searchParams.set("demo", "card/default");
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 15_000 });

  await page.waitForSelector('[data-hara-identity][data-state="fixture-signed-out"]', { timeout: 10_000 });
  await page.waitForSelector('.demo-story[aria-current="true"]', { state: "visible", timeout: 10_000 });
  await page.waitForFunction(() =>
    document.querySelector("[data-gallery-runtime-status]")?.textContent?.startsWith("Ready"),
  null,
  { timeout: 10_000 });

  const selectedTitle = await page.locator('.demo-story[aria-current="true"] span').textContent();
  assert.equal(selectedTitle, "Default <img src=x onerror=alert(1)>");
  assert.equal(await page.locator(".demo-story img").count(), 0, "Gallery metadata was interpreted as HTML");
  assert.equal(await page.frameLocator("[data-gallery-frame]").locator("body").getAttribute("data-surface"), "preview");
  assert.equal(await page.locator("[data-gallery-frame-status]").isHidden(), true);

  await page.click('[data-gallery-tab="state"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-gallery-state-content]")?.textContent?.includes("Hello from the reviewed fixture"));
  const stateText = await page.locator("[data-gallery-state-content]").textContent();
  assert.match(stateText, /"title": "Hello"/);
  assert.match(stateText, /Hello from the reviewed fixture/);

  await page.click('[data-gallery-tab="source"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-gallery-source-content]")?.textContent?.includes("(ns example.card)"));
  assert.match(await page.locator("[data-gallery-source-content]").textContent(), /defn card/);
  assert.equal(
    await page.locator("[data-gallery-source-link]").getAttribute("href"),
    `https://github.com/hara-lang/example/blob/${commit}/examples/src/example/card.hal`,
  );

  await page.click('[data-gallery-tab="docs"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-gallery-docs-content]")?.textContent?.includes("Default card"));
  assert.match(await page.locator("[data-gallery-docs-content]").textContent(), /published beside the exact package source/);

  assert.equal(identityClientRequests, 1, "Gallery did not request exactly one shared identity client");
  assert.deepEqual(pageErrors, [], `Gallery page errors:\n${pageErrors.join("\n")}`);
  assert.deepEqual(consoleErrors, [], `Gallery console errors:\n${consoleErrors.join("\n")}`);
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
}

function safeTarget(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = resolve(siteRoot, relative);
  if (target !== siteRoot && !target.startsWith(`${siteRoot}${sep}`)) {
    throw Object.assign(new Error("unsafe path"), { code: "ENOENT" });
  }
  return target;
}

function contentType(path) {
  switch (extname(path)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}
