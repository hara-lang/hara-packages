import { createHash } from "node:crypto";
import { stableJson } from "./publication-candidate.mjs";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

export function canonicalAttestation(input) {
  return stableJson({
    format: "hara-package-attestation/1",
    coordinate: input.coordinate,
    version: input.version,
    commit: input.commit,
    projectSha256: input.projectSha256,
    recipeSha256: input.recipeSha256,
    archiveSha256: input.archiveSha256,
    builder: input.builder,
  });
}

export async function finalizePublication({
  intake,
  primaryBuild,
  verificationBuild,
  objectStore,
  attest,
}) {
  if (!objectStore || typeof objectStore.get !== "function" || typeof objectStore.put !== "function") {
    throw new TypeError("Protected finalization requires an immutable object store");
  }
  if (typeof attest !== "function") throw new TypeError("Protected finalization requires an attestation signer");
  const coordinate = requiredText(intake?.coordinate, "Publication coordinate");
  const version = requiredText(intake?.version, "Publication version");
  const commit = requiredText(intake?.source?.commit, "Publication commit");
  const recipeSha256 = requiredText(intake?.source?.recipeSha256, "Publication recipe digest");
  const declaredProjectSha256 = requiredText(intake?.source?.projectSha256, "Publication project digest");
  const primary = Buffer.from(primaryBuild?.archive ?? "");
  const verified = Buffer.from(verificationBuild?.archive ?? "");
  if (!primary.length || !verified.length) throw new Error("Both credential-free builds must produce an archive");
  const archiveSha256 = digest(primary);
  if (!primary.equals(verified) || digest(verified) !== archiveSha256) {
    throw new Error("Independent credential-free builds produced different archive bytes");
  }
  const projectSha256 = requiredText(primaryBuild.projectSha256, "Build project digest");
  if (projectSha256 !== verificationBuild.projectSha256) throw new Error("Independent builds used different project inputs");
  if (projectSha256 !== declaredProjectSha256) throw new Error("Build project digest does not match the signed publication intent");
  const existing = await objectStore.get(archiveSha256);
  if (existing !== null && !Buffer.from(existing).equals(primary)) {
    throw new Error("Immutable object digest conflicts with different archive bytes");
  }
  if (existing === null) await objectStore.put(archiveSha256, primary);
  const attestationInput = {
    coordinate,
    version,
    commit,
    projectSha256,
    recipeSha256,
    archiveSha256,
    builder: requiredText(primaryBuild.builder, "Build identity"),
  };
  const statement = canonicalAttestation(attestationInput);
  const attestation = await attest(statement);
  if (typeof attestation !== "string" || !attestation) throw new Error("Finalizer did not return an attestation signature");
  return {
    "hara/type": ":package-release",
    "release/format": "0.0.0-alpha",
    "release/coordinate": coordinate,
    "release/version": version,
    "release/commit": commit,
    "release/project-sha256": projectSha256,
    "release/archive-sha256": archiveSha256,
    "release/attestation": { statement, signature: attestation },
  };
}
