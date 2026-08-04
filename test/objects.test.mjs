import test from "node:test";
import assert from "node:assert/strict";
import handler, { signRequest } from "../netlify/functions/objects.mjs";

const DIGEST = "a".repeat(64);
const ENV = {
  R2_ACCOUNT_ID: "exampleaccount",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

const request = (path, method = "GET") =>
  new Request(`https://packages.hara-lang.org${path}`, { method });

function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = original; });
}

function withEnv(run) {
  const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

// Known test vector, precomputed once against this signer and inlined.
// Credentials/date are the canonical AWS documentation example values.
test("signRequest matches the known SigV4 test vector", () => {
  const signed = signRequest({
    method: "GET",
    host: "exampleaccount.r2.cloudflarestorage.com",
    path: `/hara-objects/sha256/${DIGEST}`,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    date: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(signed.amzDate, "20130524T000000Z");
  assert.equal(
    signed.signature,
    "207a0232cf673011d175212412e9e010556d5920bb0452a873d69da06ab2ef23",
  );
  assert.equal(
    signed.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=207a0232cf673011d175212412e9e010556d5920bb0452a873d69da06ab2ef23",
  );
});

test("object reads stream the R2 body with immutable cache headers", async () => {
  await withEnv(() => withFetch(
    async (url, init) => {
      assert.equal(url, `https://exampleaccount.r2.cloudflarestorage.com/hara-objects/sha256/${DIGEST}`);
      assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
      assert.match(init.headers["x-amz-date"], /^\d{8}T\d{6}Z$/);
      return new Response("object-bytes", {
        status: 200,
        headers: { "content-type": "application/octet-stream", etag: '"deadbeef"' },
      });
    },
    async () => {
      const response = await handler(request(`/objects/sha256/${DIGEST}`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.equal(response.headers.get("etag"), '"deadbeef"');
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await response.text(), "object-bytes");
    },
  ));
});

test("unknown object paths are a 404 EDN problem", async () => {
  for (const path of ["/objects", "/objects/sha1/" + "a".repeat(40), "/objects/sha256/" + "A".repeat(64), "/objects/sha256/" + "a".repeat(63)]) {
    const response = await handler(request(path));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      await response.text(),
      '{:error/code :not-found :error/message "unknown object path"}\n',
    );
  }
});

test("R2 404 is a 404 EDN problem with no-store", async () => {
  await withEnv(() => withFetch(
    async () => new Response("NoSuchKey", { status: 404 }),
    async () => {
      const response = await handler(request(`/objects/sha256/${DIGEST}`));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        await response.text(),
        '{:error/code :not-found :error/message "object not found"}\n',
      );
    },
  ));
});

test("upstream failure is a 502 EDN problem", async () => {
  await withEnv(() => withFetch(
    async () => new Response("boom", { status: 500 }),
    async () => {
      const response = await handler(request(`/objects/sha256/${DIGEST}`));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        await response.text(),
        '{:error/code :upstream-unavailable :error/message "object store unavailable"}\n',
      );
    },
  ));
});

test("missing R2 credentials are a 502 without leaking internals", async () => {
  const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  for (const k of Object.keys(ENV)) delete process.env[k];
  try {
    const response = await handler(request(`/objects/sha256/${DIGEST}`));
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.equal(body, '{:error/code :upstream-unavailable :error/message "object store unavailable"}\n');
    assert.doesNotMatch(body, /R2_/);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("non-GET methods are a 405 EDN problem", async () => {
  const response = await handler(request(`/objects/sha256/${DIGEST}`, "POST"));
  assert.equal(response.status, 405);
  assert.equal(
    await response.text(),
    '{:error/code :method-not-allowed :error/message "public service endpoints are read-only"}\n',
  );
});
