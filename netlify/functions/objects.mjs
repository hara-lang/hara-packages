// Streaming R2 proxy for digest-addressed package objects. No runtime
// dependencies: the AWS SigV4 signature is hand-rolled on node:crypto.

import { createHash, createHmac } from "node:crypto";

const OBJECT_PATH = /^\/objects\/sha256\/([0-9a-f]{64})$/;
const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// Pure SigV4 signer (AWS4-HMAC-SHA256, service s3, region auto) exported for
// unit tests. GET/HEAD object reads have no payload, so the payload hash is
// the sha256 of the empty string.
export function signRequest({ method, host, path, accessKeyId, secretAccessKey, date }) {
  const amzDate = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, EMPTY_PAYLOAD_SHA256].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    amzDate,
    payloadHash: EMPTY_PAYLOAD_SHA256,
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function edn(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/edn; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { ...init, headers });
}

function problem(status, code, message) {
  return edn(`{:error/code :${code} :error/message ${JSON.stringify(message)}}\n`, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return problem(405, "method-not-allowed", "public service endpoints are read-only");
  }
  const match = OBJECT_PATH.exec(new URL(req.url).pathname);
  if (match === null) {
    return problem(404, "not-found", "unknown object path");
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error(JSON.stringify({ event: "objects-misconfigured" }));
    return problem(502, "upstream-unavailable", "object store unavailable");
  }
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/hara-objects/sha256/${match[1]}`;
  const signed = signRequest({
    method: req.method,
    host,
    path,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    date: new Date(),
  });
  let upstream;
  try {
    upstream = await fetch(`https://${host}${path}`, {
      method: req.method,
      headers: {
        authorization: signed.authorization,
        "x-amz-date": signed.amzDate,
        "x-amz-content-sha256": signed.payloadHash,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "objects-fetch-failed" }));
    return problem(502, "upstream-unavailable", "object store unavailable");
  }
  if (upstream.status === 404) {
    return problem(404, "not-found", "object not found");
  }
  if (!upstream.ok) {
    console.error(JSON.stringify({ event: "objects-read-failed", status: upstream.status }));
    return problem(502, "upstream-unavailable", "object store unavailable");
  }
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const etag = upstream.headers.get("etag");
  if (etag !== null) headers.set("etag", etag);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null) headers.set("content-length", contentLength);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(req.method === "HEAD" ? null : upstream.body, { status: 200, headers });
};

export const config = { path: "/objects/*" };
