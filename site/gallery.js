const GALLERY_FORMAT = "0.0.0-alpha";
const ASSET_VERSION = "20260809-1";
const SHOWCASE_PROTOCOL_VERSION = 1;
const SELECT_SURFACE = "hara.showcase/select-surface";
const READY = "hara.showcase/ready";
const SELECTION = "hara.showcase/selection";
const SHOWCASE_ERROR = "hara.showcase/error";
const SELECTOR = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const TABS = new Set(["canvas", "state", "source", "docs"]);
const VIEWPORTS = Object.freeze({
  responsive: null,
  mobile: Object.freeze({ width: 390, height: 844 }),
  tablet: Object.freeze({ width: 768, height: 1024 }),
  desktop: Object.freeze({ width: 1440, height: 900 }),
});
const KNOWN_PLAYGROUND_ORIGINS = new Set([
  "https://playground.hara-lang.org",
  "https://playground.testing.hara-lang.org",
]);

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeGallerySelector(value, label = "Gallery selector") {
  if (value == null || String(value).trim() === "") return null;
  const output = String(value).trim().replace(/^:/, "");
  const parts = output.split("/");
  if (
    !SELECTOR.test(output)
    || output.includes("//")
    || parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a bounded package selector`);
  }
  return output;
}

export function normalizeGalleryPath(value, label = "Gallery path", { optional = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a relative path`);
  const output = value.trim();
  if (!output || output.startsWith("/") || output.endsWith("/") || output.includes("\\")) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  const parts = output.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[?#\u0000-\u001f]/.test(part))) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  return parts.join("/");
}

function sourceIdentity(source) {
  if (!plainRecord(source) || !REPOSITORY.test(source.repository || "") || !COMMIT.test(source.commit || "")) {
    throw new Error("Gallery source must identify an exact GitHub commit");
  }
  const root = source.root ? normalizeGalleryPath(source.root, "Gallery source root") : "";
  return { repository: source.repository, commit: source.commit, root };
}

function joinedSourcePath(source, path) {
  const identity = sourceIdentity(source);
  const relative = normalizeGalleryPath(path);
  return [identity.root, relative].filter(Boolean).join("/");
}

export function exactSourceUrl(source, path, { raw = false } = {}) {
  const identity = sourceIdentity(source);
  const joined = joinedSourcePath(source, path);
  const encoded = joined.split("/").map(encodeURIComponent).join("/");
  if (raw) {
    return `https://raw.githubusercontent.com/${identity.repository}/${identity.commit}/${encoded}`;
  }
  return `https://github.com/${identity.repository}/blob/${identity.commit}/${encoded}`;
}

export function exactRepositoryUrl(source) {
  const identity = sourceIdentity(source);
  const suffix = identity.root
    ? `/${identity.root.split("/").map(encodeURIComponent).join("/")}`
    : "";
  return `https://github.com/${identity.repository}/tree/${identity.commit}${suffix}`;
}

function localHostname(value) {
  return new Set(["localhost", "127.0.0.1", "[::1]"]).has(value);
}

export function allowedPlaygroundUrl(value, location = globalThis.location) {
  const url = new URL(value, location?.href || "http://localhost/");
  if (KNOWN_PLAYGROUND_ORIGINS.has(url.origin)) return url;
  const current = new URL(location?.href || `${location?.origin || "http://localhost"}/`);
  if (localHostname(current.hostname) && localHostname(url.hostname) && current.protocol === url.protocol) return url;
  throw new Error(`Untrusted Playground origin: ${url.origin}`);
}

function versionsOf(entry) {
  return Array.isArray(entry?.versions) ? entry.versions : [];
}

function demosOf(version) {
  return Array.isArray(version?.demos) ? version.demos : [];
}

export function galleryStoryCount(index) {
  return (index?.packages || []).reduce((total, entry) =>
    total + versionsOf(entry).reduce((subtotal, version) => subtotal + demosOf(version).length, 0), 0);
}

export function resolveGallerySelection(index, request = {}) {
  const packages = Array.isArray(index?.packages) ? index.packages : [];
  if (!packages.length) return null;
  const requestedPackage = normalizeGallerySelector(request.packageId, "Package selector");
  const packageEntry = packages.find((entry) => entry.id === requestedPackage) || packages[0];
  const versions = versionsOf(packageEntry);
  if (!versions.length) return null;
  const requestedVersion = request.version == null ? null : String(request.version).trim();
  const version = versions.find((entry) => entry.version === requestedVersion) || versions[0];
  const demos = demosOf(version);
  if (!demos.length) return null;
  const requestedDemo = normalizeGallerySelector(request.demoId, "Demo selector");
  const demo = demos.find((entry) => entry.id === requestedDemo)
    || demos.find((entry) => entry.default)
    || demos[0];
  const views = Array.isArray(version.views) ? version.views : [];
  const states = Array.isArray(version.states) ? version.states : [];
  const view = views.find((entry) => entry.id === demo.view) || null;
  const namedState = demo.state ? states.find((entry) => entry.id === demo.state) || null : null;
  return { packageEntry, version, demo, view, state: namedState };
}

export function galleryRequestFromLocation(location = globalThis.location) {
  const query = new URLSearchParams(location?.search || "");
  const tab = query.get("tab");
  const viewport = query.get("viewport");
  const theme = query.get("theme");
  return {
    packageId: normalizeGallerySelector(query.get("package"), "Package selector"),
    version: query.get("version") || null,
    demoId: normalizeGallerySelector(query.get("demo"), "Demo selector"),
    surface: normalizeGallerySelector(query.get("surface"), "Surface selector"),
    tab: TABS.has(tab) ? tab : "canvas",
    viewport: viewport === "demo" || Object.hasOwn(VIEWPORTS, viewport) ? viewport : "responsive",
    theme: theme === "light" || theme === "dark" ? theme : "demo",
  };
}

export function galleryDeepLink(selection, options = {}, location = globalThis.location) {
  const url = new URL(location?.href || "http://localhost/");
  for (const key of ["package", "version", "demo", "surface", "tab", "viewport", "theme"]) {
    url.searchParams.delete(key);
  }
  if (!selection) return url.href;
  url.searchParams.set("package", selection.packageEntry.id);
  url.searchParams.set("version", selection.version.version);
  url.searchParams.set("demo", selection.demo.id);
  url.searchParams.set("surface", options.surface || selection.demo.surface);
  url.searchParams.set("tab", TABS.has(options.tab) ? options.tab : "canvas");
  url.searchParams.set("viewport", options.viewport || "responsive");
  url.searchParams.set("theme", options.theme || "demo");
  return url.href;
}

export function displayStateValue(value) {
  if (value === undefined) return "No inline state value was published.";
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validIndex(value) {
  if (!plainRecord(value) || value.format !== GALLERY_FORMAT || value.registry !== "hara" || !Array.isArray(value.packages)) {
    throw new Error("Gallery index does not match Hara Gallery format 0.0.0-alpha");
  }
  return value;
}

function createElement(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (name === "class") element.className = value;
    else if (name === "text") element.textContent = value;
    else if (name === "dataset") Object.assign(element.dataset, value);
    else if (name === "open") element.open = Boolean(value);
    else if (name in element && typeof value !== "object") element[name] = value;
    else element.setAttribute(name, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function codeTarget(element) {
  return element?.querySelector("code") || element;
}

class PackageGallery {
  constructor(root) {
    this.root = root;
    this.index = null;
    this.selection = null;
    this.filter = "";
    this.resourceRequest = 0;
    this.resourceCache = new Map();
    this.request = galleryRequestFromLocation();
    this.tab = this.request.tab;
    this.viewport = this.request.viewport;
    this.theme = this.request.theme;
    this.surface = this.request.surface;
    this.frameReady = false;
    this.elements = this.collectElements();
    this.bind();
  }

  collectElements() {
    const query = (selector) => this.root.querySelector(selector) || document.querySelector(selector);
    const all = (selector) => [...this.root.querySelectorAll(selector)];
    return {
      search: query("[data-gallery-search]"),
      tree: query("[data-gallery-tree]"),
      count: query("[data-gallery-count]"),
      package: query("[data-gallery-package]"),
      version: query("[data-gallery-version]"),
      demo: query("[data-gallery-demo]"),
      surface: query("[data-gallery-surface]"),
      theme: query("[data-gallery-theme]"),
      viewport: query("[data-gallery-viewport]"),
      copy: query("[data-gallery-copy-link]"),
      openPlayground: query("[data-gallery-open-playground]"),
      frame: query("[data-gallery-frame]"),
      frameShell: query("[data-gallery-frame-shell]"),
      frameStatus: query("[data-gallery-frame-status]"),
      tabs: all("[data-gallery-tab]"),
      panels: all("[data-gallery-panel]"),
      empty: query("[data-gallery-empty]"),
      failure: query("[data-gallery-failure]"),
      failureMessage: query("[data-gallery-failure-message]"),
      retry: query("[data-gallery-retry]"),
      sidebarToggle: query("[data-gallery-sidebar-toggle]"),
      runtimeStatus: query("[data-gallery-runtime-status]"),
      commit: query("[data-gallery-commit]"),
      detailTitle: query("[data-gallery-detail-title]"),
      detailSummary: query("[data-gallery-detail-summary]"),
      detailPackage: query("[data-gallery-detail-package]"),
      detailVersion: query("[data-gallery-detail-version]"),
      detailView: query("[data-gallery-detail-view]"),
      detailState: query("[data-gallery-detail-state]"),
      detailSurface: query("[data-gallery-detail-surface]"),
      detailCommit: query("[data-gallery-detail-commit]"),
      tags: query("[data-gallery-tags]"),
      repositoryLink: query("[data-gallery-repository-link]"),
      showcaseLink: query("[data-gallery-showcase-link]"),
      stateTitle: query("[data-gallery-state-title]"),
      stateSummary: query("[data-gallery-state-summary]"),
      stateContent: query("[data-gallery-state-content]"),
      stateLink: query("[data-gallery-state-link]"),
      sourceTitle: query("[data-gallery-source-title]"),
      sourceSummary: query("[data-gallery-source-summary]"),
      sourceContent: query("[data-gallery-source-content]"),
      sourceLink: query("[data-gallery-source-link]"),
      docsTitle: query("[data-gallery-docs-title]"),
      docsSummary: query("[data-gallery-docs-summary]"),
      docsContent: query("[data-gallery-docs-content]"),
      docsLink: query("[data-gallery-docs-link]"),
    };
  }

  bind() {
    this.elements.search?.addEventListener("input", () => {
      this.filter = this.elements.search.value.trim().toLowerCase();
      this.renderTree();
    });
    this.elements.tabs.forEach((button) => button.addEventListener("click", () => this.setTab(button.dataset.galleryTab)));
    this.elements.viewport?.addEventListener("change", () => {
      this.viewport = this.elements.viewport.value;
      this.applyViewport();
      this.syncLocation();
    });
    this.elements.theme?.addEventListener("change", () => {
      this.theme = this.elements.theme.value;
      this.mountFrame();
      this.syncLocation();
    });
    this.elements.surface?.addEventListener("change", () => this.selectSurface(this.elements.surface.value));
    this.elements.copy?.addEventListener("click", () => this.copyLink());
    this.elements.retry?.addEventListener("click", () => this.load());
    this.elements.sidebarToggle?.addEventListener("click", () => this.toggleSidebar());
    this.elements.frame?.addEventListener("load", () => {
      if (!this.frameReady) this.setFrameStatus("loading", "Waiting for the Hara Showcase host…");
    });
    globalThis.addEventListener("message", (event) => this.onMessage(event));
    globalThis.addEventListener("popstate", () => {
      this.request = galleryRequestFromLocation();
      this.tab = this.request.tab;
      this.viewport = this.request.viewport;
      this.theme = this.request.theme;
      this.surface = this.request.surface;
      if (this.index) this.select(this.request, { history: false });
    });
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === "/" && !editing) {
        event.preventDefault();
        this.elements.search?.focus();
      }
      if (event.key === "Escape") this.closeSidebar();
    });
  }

  async load() {
    this.root.dataset.galleryStatus = "loading";
    this.showSpecial(null);
    this.elements.runtimeStatus.textContent = "Loading reviewed Gallery index";
    try {
      const response = await fetch(`./gallery.json?v=${ASSET_VERSION}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Gallery index request failed (${response.status})`);
      this.index = validIndex(await response.json());
      const count = galleryStoryCount(this.index);
      this.elements.count.textContent = `${count} ${count === 1 ? "story" : "stories"}`;
      if (!count) {
        this.root.dataset.galleryStatus = "empty";
        this.renderTree();
        this.showSpecial("empty");
        this.elements.runtimeStatus.textContent = "No finalized package Showcases have been published yet";
        return;
      }
      this.root.dataset.galleryStatus = "ready";
      this.select(this.request, { history: true });
    } catch (error) {
      this.root.dataset.galleryStatus = "error";
      this.elements.failureMessage.textContent = error?.message || String(error);
      this.showSpecial("failure");
      this.elements.runtimeStatus.textContent = "Gallery index unavailable";
    }
  }

  showSpecial(kind) {
    this.elements.empty.hidden = kind !== "empty";
    this.elements.failure.hidden = kind !== "failure";
    for (const panel of this.elements.panels) panel.hidden = Boolean(kind) || panel.dataset.galleryPanel !== this.tab;
  }

  select(request, { history = true } = {}) {
    const next = resolveGallerySelection(this.index, request);
    if (!next) {
      this.root.dataset.galleryStatus = "empty";
      this.showSpecial("empty");
      return;
    }
    this.selection = next;
    this.surface = normalizeGallerySelector(request.surface, "Surface selector") || next.demo.surface;
    this.tab = TABS.has(request.tab) ? request.tab : this.tab;
    this.viewport = request.viewport === "demo" || Object.hasOwn(VIEWPORTS, request.viewport) ? request.viewport : this.viewport;
    this.theme = request.theme === "light" || request.theme === "dark" ? request.theme : this.theme;
    this.frameReady = false;
    this.renderTree();
    this.renderSelection();
    this.setTab(this.tab, { history: false });
    this.applyViewport();
    this.mountFrame();
    this.closeSidebar();
    if (history) this.syncLocation();
  }

  renderTree() {
    const container = this.elements.tree;
    container.replaceChildren();
    const packages = this.index?.packages || [];
    let visible = 0;
    for (const packageEntry of packages) {
      const packageMatches = packageEntry.id.toLowerCase().includes(this.filter);
      const packageDetails = createElement("details", { class: "package-group", open: true });
      packageDetails.append(createElement("summary", { text: packageEntry.id }));
      let packageVisible = 0;
      for (const version of versionsOf(packageEntry)) {
        const versionDetails = createElement("details", { class: "version-group", open: true });
        versionDetails.append(createElement("summary", { text: version.version }));
        const grouped = new Map();
        for (const demo of demosOf(version)) {
          const view = (version.views || []).find((entry) => entry.id === demo.view);
          const haystack = [packageEntry.id, version.version, version.title, demo.id, demo.title, demo.summary, ...(demo.tags || [])]
            .filter(Boolean).join(" ").toLowerCase();
          if (this.filter && !packageMatches && !haystack.includes(this.filter)) continue;
          if (!grouped.has(demo.view)) grouped.set(demo.view, { view, demos: [] });
          grouped.get(demo.view).demos.push(demo);
        }
        for (const [viewId, group] of grouped) {
          const viewDetails = createElement("details", { class: "view-group", open: true });
          viewDetails.append(createElement("summary", { text: group.view?.title || viewId }));
          for (const demo of group.demos) {
            const active = this.selection
              && this.selection.packageEntry.id === packageEntry.id
              && this.selection.version.version === version.version
              && this.selection.demo.id === demo.id;
            const button = createElement("button", {
              class: "demo-story",
              type: "button",
              role: "treeitem",
              "aria-current": active ? "true" : "false",
              title: demo.summary || demo.title,
            }, createElement("span", { text: demo.title }));
            button.addEventListener("click", () => this.select({
              packageId: packageEntry.id,
              version: version.version,
              demoId: demo.id,
              tab: this.tab,
              viewport: this.viewport,
              theme: this.theme,
            }));
            viewDetails.append(button);
            visible += 1;
            packageVisible += 1;
          }
          versionDetails.append(viewDetails);
        }
        if (versionDetails.querySelector(".demo-story")) packageDetails.append(versionDetails);
      }
      if (packageVisible) container.append(packageDetails);
    }
    if (!visible) container.append(createElement("p", { class: "tree-empty", text: this.filter ? "No package demos match this search." : "No published package demos." }));
  }

  renderSelection() {
    const { packageEntry, version, demo, view, state } = this.selection;
    this.elements.package.textContent = packageEntry.id;
    this.elements.version.textContent = version.version;
    this.elements.demo.textContent = demo.title;
    this.elements.detailTitle.textContent = demo.title;
    this.elements.detailSummary.textContent = demo.summary || version.summary || "A reviewed Hara package demo.";
    this.elements.detailPackage.textContent = packageEntry.id;
    this.elements.detailVersion.textContent = version.version;
    this.elements.detailView.textContent = view?.title || demo.view;
    this.elements.detailState.textContent = state?.title || "No named state";
    this.elements.detailSurface.textContent = demo.surface;
    this.elements.detailCommit.textContent = version.source.commit.slice(0, 12);
    this.elements.commit.textContent = `source ${version.source.commit.slice(0, 12)}`;
    this.elements.tags.replaceChildren(...(demo.tags || []).map((tag) => createElement("span", { class: "gallery-tag", text: tag })));
    this.elements.repositoryLink.href = exactRepositoryUrl(version.source);
    this.elements.showcaseLink.href = `https://github.com/hara-lang/hara-packages/blob/main/${version.registryPath.split("/").map(encodeURIComponent).join("/")}`;
    this.elements.openPlayground.href = this.frameUrl().href;
    this.elements.theme.value = this.theme;
    this.elements.viewport.value = this.viewport;
    this.renderStatePanel();
    this.renderSourcePanel();
    this.renderDocsPanel();
  }

  frameUrl() {
    const url = allowedPlaygroundUrl(this.selection.demo.playgroundUrl);
    url.searchParams.set("surface", this.surface || this.selection.demo.surface);
    if (this.theme === "light" || this.theme === "dark") url.searchParams.set("theme", this.theme);
    else if (this.selection.demo.theme) url.searchParams.set("theme", this.selection.demo.theme);
    else url.searchParams.delete("theme");
    return url;
  }

  mountFrame() {
    if (!this.selection) return;
    const url = this.frameUrl();
    this.frameReady = false;
    this.elements.surface.disabled = true;
    this.elements.surface.replaceChildren(createElement("option", { value: this.surface, text: `Surface: ${this.surface}` }));
    this.setFrameStatus("loading", "Opening immutable package demo…");
    this.elements.frame.src = url.href;
    this.elements.openPlayground.href = url.href;
  }

  setFrameStatus(status, message, { hidden = false } = {}) {
    this.elements.frameStatus.hidden = hidden;
    this.elements.frameStatus.dataset.status = status;
    this.elements.frameStatus.querySelector("span").textContent = message;
    this.elements.runtimeStatus.textContent = message;
  }

  onMessage(event) {
    if (!this.selection || event.source !== this.elements.frame.contentWindow) return;
    let expected;
    try {
      expected = this.frameUrl().origin;
    } catch {
      return;
    }
    if (event.origin !== expected || !plainRecord(event.data) || event.data.version !== SHOWCASE_PROTOCOL_VERSION) return;
    if (event.data.type === READY) {
      const surfaces = Array.isArray(event.data.surfaces)
        ? event.data.surfaces.map((entry) => normalizeGallerySelector(entry, "Showcase surface")).filter(Boolean)
        : [];
      if (!surfaces.length || !surfaces.includes(event.data.surfaceId)) {
        this.setFrameStatus("error", "The Showcase host returned an invalid surface declaration.");
        return;
      }
      this.frameReady = true;
      this.surface = event.data.surfaceId;
      this.elements.surface.replaceChildren(...surfaces.map((surface) => createElement("option", {
        value: surface,
        text: `Surface: ${surface}`,
        selected: surface === this.surface,
      })));
      this.elements.surface.disabled = false;
      this.elements.detailSurface.textContent = this.surface;
      this.setFrameStatus("ready", `Ready · ${this.surface}`, { hidden: true });
      this.syncLocation();
      return;
    }
    if (event.data.type === SELECTION) {
      if (event.data.ok === false) {
        this.setFrameStatus("error", event.data.message || "The selected surface was rejected.");
        return;
      }
      this.surface = normalizeGallerySelector(event.data.surfaceId, "Showcase surface") || this.surface;
      this.elements.surface.value = this.surface;
      this.elements.detailSurface.textContent = this.surface;
      this.setFrameStatus("ready", `Ready · ${this.surface}`, { hidden: true });
      this.syncLocation();
      return;
    }
    if (event.data.type === SHOWCASE_ERROR) {
      this.setFrameStatus("error", event.data.message || "The package demo could not be opened.");
    }
  }

  selectSurface(surface) {
    const selected = normalizeGallerySelector(surface, "Showcase surface");
    if (!selected || !this.frameReady) return;
    const targetOrigin = this.frameUrl().origin;
    this.elements.frame.contentWindow?.postMessage({
      type: SELECT_SURFACE,
      version: SHOWCASE_PROTOCOL_VERSION,
      surfaceId: selected,
    }, targetOrigin);
    this.setFrameStatus("loading", `Selecting ${selected}…`);
  }

  setTab(tab, { history = true } = {}) {
    if (!TABS.has(tab)) return;
    this.tab = tab;
    this.elements.tabs.forEach((button) => {
      const active = button.dataset.galleryTab === tab;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    for (const panel of this.elements.panels) panel.hidden = panel.dataset.galleryPanel !== tab;
    this.elements.empty.hidden = true;
    this.elements.failure.hidden = true;
    if (tab !== "canvas") this.loadActiveResource();
    if (history) this.syncLocation();
  }

  applyViewport() {
    if (!this.selection) return;
    let dimensions = VIEWPORTS[this.viewport] || null;
    if (this.viewport === "demo") dimensions = this.selection.demo.viewport || null;
    this.elements.frameShell.dataset.viewport = dimensions ? this.viewport : "responsive";
    if (dimensions) {
      this.elements.frameShell.style.setProperty("--frame-width", `${dimensions.width}px`);
      this.elements.frameShell.style.setProperty("--frame-height", `${dimensions.height}px`);
    } else {
      this.elements.frameShell.style.removeProperty("--frame-width");
      this.elements.frameShell.style.removeProperty("--frame-height");
    }
  }

  renderStatePanel() {
    const state = this.selection.state;
    this.elements.stateTitle.textContent = state?.title || "No named state";
    this.elements.stateSummary.textContent = state?.summary || (state ? "Reviewed state published with this package release." : "This demo does not declare a named state.");
    codeTarget(this.elements.stateContent).textContent = state ? displayStateValue(state.value) : "Select a demo with a named state.\n";
    this.setResourceLink(this.elements.stateLink, state?.file ? exactSourceUrl(this.selection.version.source, state.file) : null, "Open fixture");
  }

  renderSourcePanel() {
    const view = this.selection.view;
    this.elements.sourceTitle.textContent = view?.title || this.selection.demo.title;
    this.elements.sourceSummary.textContent = view?.summary || "Exact source from the immutable package commit.";
    codeTarget(this.elements.sourceContent).textContent = view?.source ? `Loading ${view.source}…\n` : "This view does not publish a source path.\n";
    this.setResourceLink(this.elements.sourceLink, view?.source ? exactSourceUrl(this.selection.version.source, view.source) : null, "Open on GitHub");
  }

  renderDocsPanel() {
    const path = this.selection.demo.docs || this.selection.view?.docs || null;
    this.elements.docsTitle.textContent = this.selection.demo.title;
    this.elements.docsSummary.textContent = this.selection.demo.summary || this.selection.view?.summary || "Published documentation from the immutable package commit.";
    codeTarget(this.elements.docsContent).textContent = path ? `Loading ${path}…\n` : "This demo does not publish a documentation path.\n";
    this.setResourceLink(this.elements.docsLink, path ? exactSourceUrl(this.selection.version.source, path) : null, "Open on GitHub");
  }

  setResourceLink(element, href, label) {
    element.hidden = !href;
    element.textContent = label;
    if (href) element.href = href;
    else element.removeAttribute("href");
  }

  async loadActiveResource() {
    if (!this.selection) return;
    const request = ++this.resourceRequest;
    if (this.tab === "state") {
      const state = this.selection.state;
      if (!state?.file) return;
      const inline = state.value === undefined ? "" : `${displayStateValue(state.value)}\n— reviewed fixture —\n`;
      await this.loadResource(state.file, this.elements.stateContent, request, inline);
      return;
    }
    if (this.tab === "source") {
      const path = this.selection.view?.source;
      if (path) await this.loadResource(path, this.elements.sourceContent, request);
      return;
    }
    if (this.tab === "docs") {
      const path = this.selection.demo.docs || this.selection.view?.docs;
      if (path) await this.loadResource(path, this.elements.docsContent, request);
    }
  }

  async loadResource(path, target, request, prefix = "") {
    let url;
    try {
      url = exactSourceUrl(this.selection.version.source, path, { raw: true });
      codeTarget(target).textContent = `${prefix}Loading ${path}…\n`;
      let content = this.resourceCache.get(url);
      if (content == null) {
        const response = await fetch(url, { cache: "force-cache", headers: { Accept: "text/plain" } });
        if (!response.ok) throw new Error(`Exact source request failed (${response.status})`);
        content = await response.text();
        if (content.length > 1_000_000) content = `${content.slice(0, 1_000_000)}\n\n… truncated by the Gallery …\n`;
        this.resourceCache.set(url, content);
      }
      if (request !== this.resourceRequest) return;
      codeTarget(target).textContent = `${prefix}${content}`;
    } catch (error) {
      if (request !== this.resourceRequest) return;
      codeTarget(target).textContent = `${prefix}Unable to load ${path}: ${error?.message || String(error)}\n`;
    }
  }

  syncLocation() {
    if (!this.selection) return;
    const href = galleryDeepLink(this.selection, {
      surface: this.surface,
      tab: this.tab,
      viewport: this.viewport,
      theme: this.theme,
    });
    history.replaceState({}, "", href);
  }

  async copyLink() {
    const href = galleryDeepLink(this.selection, {
      surface: this.surface,
      tab: this.tab,
      viewport: this.viewport,
      theme: this.theme,
    });
    try {
      await navigator.clipboard.writeText(href);
      this.elements.copy.textContent = "Copied";
      setTimeout(() => { this.elements.copy.textContent = "Copy link"; }, 1200);
    } catch {
      this.elements.runtimeStatus.textContent = "Copy unavailable — use the current address";
    }
  }

  toggleSidebar() {
    const open = !this.root.classList.contains("sidebar-open");
    this.root.classList.toggle("sidebar-open", open);
    this.elements.sidebarToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  closeSidebar() {
    this.root.classList.remove("sidebar-open");
    this.elements.sidebarToggle?.setAttribute("aria-expanded", "false");
  }
}

export function startPackageGallery(root = document.querySelector("[data-gallery-app]")) {
  if (!root) return null;
  const gallery = new PackageGallery(root);
  gallery.load();
  return gallery;
}

if (typeof document !== "undefined") startPackageGallery();
