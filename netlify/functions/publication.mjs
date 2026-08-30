import { createSign } from "node:crypto";
import {
  loadSignedIdentityPolicy,
  parsePublicationIntent,
  parsePublicationSubmission,
  verifyPublicationSubmission,
} from "../../src/publication-submission.mjs";

const MAX_BODY_BYTES = 128 * 1024;

export const config = {
  path: "/v1/publications",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

function envValue(env, name) {
  const value = env?.[name] ?? globalThis.Netlify?.env?.get?.(name);
  return typeof value === "string" ? value.trim() : "";
}

function response(payload, status = 200) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function problem(status, code, message) {
  return response({ error: { code, message } }, status);
}

async function body(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new TypeError("Publication request body is too large.");
  let parsed;
  try {
    parsed = await request.json();
  } catch {
    throw new TypeError("Publication request body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Publication request body must be a JSON object.");
  return parsed;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function appJwt(env, now) {
  const appId = envValue(env, "HARA_PACKAGES_APP_ID");
  const privateKey = envValue(env, "HARA_PACKAGES_APP_PRIVATE_KEY");
  const issuedAt = Math.floor(now / 1000) - 30;
  if (!appId || !privateKey) throw new Error("Packages GitHub App is not configured.");
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey.replaceAll("\\n", "\n")).toString("base64url")}`;
}

async function installationToken(env, fetchImpl, now) {
  const installation = envValue(env, "HARA_PACKAGES_APP_INSTALLATION_ID");
  if (!installation) throw new Error("Packages GitHub App is not configured.");
  const token = await fetchImpl(`https://api.github.com/app/installations/${encodeURIComponent(installation)}/access_tokens`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${appJwt(env, now)}`, "user-agent": "hara-packages-intake" },
  });
  const value = token.ok ? await token.json() : null;
  if (typeof value?.token !== "string") throw new Error("Packages GitHub App authorization is unavailable.");
  return value.token;
}

async function github(url, init, token, fetchImpl) {
  const response = await fetchImpl(`https://api.github.com${url}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "hara-packages-intake",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const value = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub request ${url} failed (${response.status}): ${value?.message ?? "unknown error"}`);
  return value;
}

function receipt(verified, submission) {
  const { intent, keyId, githubSubject, authorizationNonce } = verified;
  return {
    format: "hara-package-intake/1",
    coordinate: intent.coordinate,
    version: intent.version,
    source: {
      repository: intent.repository,
      tag: intent.tag,
      commit: intent.commit,
      projectSha256: intent.projectSha256,
      recipeSha256: intent.recipeSha256,
    },
    publisher: { keyId, githubSubject, authorizationNonce },
    intent: submission.intent,
    signature: submission.signature,
    authorization: submission.authorization,
  };
}

function branch(verified) {
  const { owner, name, version } = verified.intent;
  return `publisher/${owner}/${name}/${version}-${verified.authorizationNonce.slice(0, 12)}`;
}

function requestPath(verified) {
  const { owner, name, version } = verified.intent;
  return `intake/${owner}/${name}/${version}.json`;
}

async function createGitHubRequest(verified, submission, { env, fetchImpl, now }) {
  const repository = envValue(env, "HARA_PACKAGES_REPOSITORY") || "hara-lang/hara-packages";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Packages repository configuration is invalid.");
  const token = await installationToken(env, fetchImpl, now);
  const head = branch(verified);
  const owner = repository.split("/")[0];
  const current = await github(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`, { method: "GET" }, token, fetchImpl);
  if (Array.isArray(current) && current.length) return { url: current[0].html_url, number: current[0].number, reused: true };
  const base = await github(`/repos/${repository}/git/ref/heads/main`, { method: "GET" }, token, fetchImpl);
  await github(`/repos/${repository}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${head}`, sha: base.object.sha }) }, token, fetchImpl);
  const path = requestPath(verified);
  const content = Buffer.from(`${JSON.stringify(receipt(verified, submission), null, 2)}\n`).toString("base64");
  await github(`/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: JSON.stringify({ message: `publisher intake: ${verified.intent.coordinate} ${verified.intent.version}`, content, branch: head }),
  }, token, fetchImpl);
  const pull = await github(`/repos/${repository}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Publish ${verified.intent.coordinate} ${verified.intent.version}`,
      head,
      base: "main",
      body: `Publisher intake for \`${verified.intent.coordinate}\` \`${verified.intent.version}\`. The protected builder/finalizer workflow owns archive and release-record creation.`,
    }),
  }, token, fetchImpl);
  return { url: pull.html_url, number: pull.number, reused: false };
}

export function createMemoryReplayStore() {
  const entries = new Set();
  return {
    async has(key) { return entries.has(key); },
    async add(key) { entries.add(key); },
  };
}

let replayStorePromise;
async function replayStore() {
  replayStorePromise ??= import("@netlify/blobs").then(({ getStore }) => {
    const store = getStore({ name: "hara-publication-authorizations", consistency: "strong" });
    return {
      async has(key) { return Boolean(await store.get(`nonce/${key}`)); },
      async add(key) { await store.set(`nonce/${key}`, "1"); },
    };
  });
  return replayStorePromise;
}

export async function handle(request, {
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
  policy = null,
  store = null,
  createRequest = null,
} = {}) {
  if (request.method !== "POST") return problem(405, "METHOD_NOT_ALLOWED", "Only POST is supported.");
  try {
    const rawSubmission = await body(request);
    const submission = parsePublicationSubmission(rawSubmission);
    const intent = parsePublicationIntent(submission.intent);
    const signedPolicy = policy ?? await loadSignedIdentityPolicy(intent.identityRevision, {
      rootFingerprint: envValue(env, "HARA_OFFICIAL_ROOT_SHA256"),
      identityEndpoint: envValue(env, "HARA_ID_ENDPOINT") || "https://id.hara-lang.org",
      fetchImpl,
    });
    const verified = verifyPublicationSubmission(rawSubmission, signedPolicy, { now });
    const activeStore = store ?? await replayStore();
    if (await activeStore.has(verified.authorizationNonce)) return problem(409, "AUTHORIZATION_REPLAYED", "Publication authorization has already been used.");
    const create = createRequest ?? createGitHubRequest;
    const requestRecord = await create(verified, submission, { env, fetchImpl, now });
    await activeStore.add(verified.authorizationNonce);
    return response({ status: "request-created", coordinate: verified.intent.coordinate, version: verified.intent.version, request: requestRecord }, 202);
  } catch (error) {
    const message = error?.message || "Publication request is invalid.";
    const unavailable = /not configured|unavailable|GitHub request/.test(message);
    return problem(unavailable ? 503 : 400, unavailable ? "PUBLICATION_INTAKE_UNAVAILABLE" : "PUBLICATION_REJECTED", message);
  }
}

export default async (request) => handle(request);
