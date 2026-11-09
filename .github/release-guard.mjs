import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const STABLE_DIST_TAG = "latest";
export const PRERELEASE_DIST_TAG = "next";
export const EXPECTED_REPOSITORY = Object.freeze({
  type: "git",
  url: "https://github.com/effectstream/mip-zswap-offer.git",
});

// SemVer 2.0.0 without build metadata: npm drops "+build" from published
// versions, so a tag carrying it could never equal the registry version.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

// Prereleases whose first identifier is "v9" (e.g. 0.4.0-v9.0) were the
// ledger-v9 release-candidate channel. Stable versions replace that scheme,
// so such versions are refused instead of being published to "next".
const RETIRED_PRERELEASE = /^v9(?:\.|$)/;

export function compareNumericVersions(left, right) {
  const a = left.replace(/^v/, "").split(".");
  const b = right.replace(/^v/, "").split(".");
  if (a.some((part) => !/^\d+$/.test(part)) || b.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`Invalid numeric version comparison: ${left} / ${right}`);
  }
  const count = Math.max(a.length, b.length);
  for (let i = 0; i < count; i++) {
    const leftPart = BigInt(a[i] ?? "0");
    const rightPart = BigInt(b[i] ?? "0");
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function assertRuntimeMinimums(nodeVersion, npmVersion) {
  if (compareNumericVersions(nodeVersion, "22.14.0") < 0) {
    throw new Error(`Node ${nodeVersion} is below required 22.14.0`);
  }
  if (compareNumericVersions(npmVersion, "11.5.1") < 0) {
    throw new Error(`npm ${npmVersion} is below required 11.5.1`);
  }
}

/** Stable versions publish to "latest", prereleases to "next". */
export function distTagForVersion(version) {
  const match = SEMVER.exec(version ?? "");
  if (!match) {
    throw new Error(
      `Package version ${version || "missing"} is not a valid semver release version`,
    );
  }
  const prerelease = match[4];
  if (prerelease === undefined) return STABLE_DIST_TAG;
  if (RETIRED_PRERELEASE.test(prerelease)) {
    throw new Error(`Package version ${version} uses the retired -v9.N prerelease scheme`);
  }
  return PRERELEASE_DIST_TAG;
}

export function validateRelease({ refType, refName, pkg }) {
  if (refType !== "tag") {
    throw new Error(`Publish requires a Git tag ref, received ${refType || "missing"}`);
  }
  const distTag = distTagForVersion(pkg.version);
  const expectedTag = `v${pkg.version}`;
  if (refName !== expectedTag) {
    throw new Error(`Tag ${refName || "missing"} does not exactly match ${expectedTag}`);
  }
  if (
    pkg.repository?.type !== EXPECTED_REPOSITORY.type ||
    pkg.repository?.url !== EXPECTED_REPOSITORY.url
  ) {
    throw new Error(
      `repository metadata must exactly match ${JSON.stringify(EXPECTED_REPOSITORY)}`,
    );
  }
  return { version: pkg.version, distTag, tag: expectedTag };
}

export function validatePackReport(report, pkg) {
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error("npm pack report must contain exactly one package");
  }
  const packed = report[0];
  if (packed.name !== pkg.name || packed.version !== pkg.version) {
    throw new Error(
      `Packed identity ${packed.name}@${packed.version} does not match ${pkg.name}@${pkg.version}`,
    );
  }
  if (typeof packed.integrity !== "string" || packed.integrity.length === 0) {
    throw new Error("npm pack report has no tarball integrity");
  }
  if (typeof packed.filename !== "string" || !/^[^/\\]+\.tgz$/.test(packed.filename)) {
    throw new Error(`npm pack report has no plain .tgz filename: ${packed.filename}`);
  }
  const paths = new Set((packed.files ?? []).map((entry) => entry.path));
  for (const required of ["package.json", "README.md"]) {
    if (!paths.has(required)) throw new Error(`Packed tarball is missing ${required}`);
  }
  for (const target of Object.values(pkg.exports).flatMap((entry) =>
    Object.values(entry).map((path) => path.replace(/^\.\//, "")),
  )) {
    if (!paths.has(target)) throw new Error(`Packed tarball is missing export target ${target}`);
  }
  const forbidden = [...paths].filter(
    (path) =>
      path.startsWith(".github/") ||
      path.startsWith("tests/") ||
      path === "bun.lock" ||
      path === "tsconfig.json",
  );
  if (forbidden.length > 0) {
    throw new Error(`Packed tarball contains forbidden files: ${forbidden.join(", ")}`);
  }
  return {
    name: packed.name,
    version: packed.version,
    fileCount: paths.size,
    integrity: packed.integrity,
    filename: packed.filename,
  };
}

/**
 * Decides whether a publish step succeeded. npm can exit non-zero after the
 * registry already accepted the upload (for example a 403 "cannot publish over
 * previously published versions" answering a retried request). The registry is
 * then the source of truth: the step succeeds only if it serves this exact
 * version with the integrity of the tarball this run packed.
 */
export function decidePublishOutcome({ publishExitCode, localIntegrity, registryIntegrity }) {
  if (!Number.isInteger(publishExitCode) || publishExitCode < 0) {
    throw new Error(`Invalid npm publish exit code: ${publishExitCode}`);
  }
  if (publishExitCode === 0) {
    return { ok: true, reason: "npm publish exited 0" };
  }
  if (!localIntegrity) {
    return {
      ok: false,
      reason: `npm publish exited ${publishExitCode} and the local tarball integrity is unknown`,
    };
  }
  if (!registryIntegrity) {
    return {
      ok: false,
      reason: `npm publish exited ${publishExitCode} and the registry does not serve this version`,
    };
  }
  if (registryIntegrity !== localIntegrity) {
    return {
      ok: false,
      reason: `npm publish exited ${publishExitCode} and the registry serves a different tarball (registry ${registryIntegrity}, local ${localIntegrity})`,
    };
  }
  return {
    ok: true,
    reason: `npm publish exited ${publishExitCode}, but the registry already serves this version with the identical integrity ${localIntegrity}`,
  };
}

/** Returns the registry's dist.integrity for name@version, or "" when it cannot be read. */
export function readRegistryIntegrity(name, version) {
  try {
    const output = execFileSync(
      "npm",
      ["view", `${name}@${version}`, "dist.integrity", "--json", "--prefer-online"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const value = output === "" ? "" : JSON.parse(output);
    return typeof value === "string" ? value : "";
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim().split("\n")[0];
    console.error(`npm view ${name}@${version} failed: ${detail}`);
    return "";
  }
}

/**
 * Reads the registry up to `attempts` times, because a version that was just
 * published can take a few seconds to appear in the package metadata. A read
 * that returns any integrity ends the loop, so a different tarball fails at once.
 */
export async function verifyPublished({
  report,
  pkg,
  publishExitCode,
  readIntegrity = readRegistryIntegrity,
  attempts = 6,
  delayMs = 10_000,
}) {
  const packed = validatePackReport(report, pkg);
  const total = Math.max(1, attempts);
  let registryIntegrity = "";
  for (let attempt = 1; attempt <= total; attempt++) {
    registryIntegrity = readIntegrity(packed.name, packed.version);
    if (registryIntegrity) break;
    if (attempt < total) await sleep(delayMs);
  }
  return decidePublishOutcome({
    publishExitCode,
    localIntegrity: packed.integrity,
    registryIntegrity,
  });
}

/** Appends key=value lines to the step output file when GitHub Actions provides one. */
export function writeGithubOutput(entries, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  for (const [key, value] of Object.entries(entries)) {
    if (/[\r\n]/.test(String(value))) {
      throw new Error(`GitHub output ${key} must be a single line`);
    }
    appendFileSync(outputPath, `${key}=${value}\n`);
  }
}

function nonNegativeIntegerFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, received ${raw}`);
  }
  return value;
}

function packageJson() {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "runtime") {
      assertRuntimeMinimums(args[0] ?? "", args[1] ?? "");
      console.log(`Runtime minimums satisfied: Node ${args[0]}, npm ${args[1]}`);
    } else if (command === "release") {
      const result = validateRelease({
        refType: process.env.GITHUB_REF_TYPE,
        refName: process.env.GITHUB_REF_NAME,
        pkg: packageJson(),
      });
      writeGithubOutput({ dist_tag: result.distTag });
      console.log(
        `Release guard satisfied: ${result.tag} -> ${result.version} on ${result.distTag}`,
      );
    } else if (command === "pack") {
      const report = JSON.parse(readFileSync(args[0], "utf8"));
      const result = validatePackReport(report, packageJson());
      writeGithubOutput({ filename: result.filename, integrity: result.integrity });
      console.log(
        `Pack guard satisfied: ${result.name}@${result.version}, ${result.fileCount} files, ${result.filename} ${result.integrity}`,
      );
    } else if (command === "verify-published") {
      const exitArg = args[1] ?? "";
      if (!/^\d+$/.test(exitArg)) {
        throw new Error(`verify-published needs the npm publish exit code, received "${exitArg}"`);
      }
      const report = JSON.parse(readFileSync(args[0], "utf8"));
      const outcome = await verifyPublished({
        report,
        pkg: packageJson(),
        publishExitCode: Number(exitArg),
        attempts: nonNegativeIntegerFromEnv("VERIFY_PUBLISHED_ATTEMPTS", 6),
        delayMs: nonNegativeIntegerFromEnv("VERIFY_PUBLISHED_DELAY_MS", 10_000),
      });
      if (!outcome.ok) throw new Error(outcome.reason);
      console.log(`Publish verified: ${outcome.reason}`);
    } else {
      throw new Error(
        "Usage: release-guard.mjs <runtime NODE NPM|release|pack REPORT_JSON|verify-published REPORT_JSON PUBLISH_EXIT_CODE>",
      );
    }
  } catch (error) {
    console.error(`release guard failed: ${error.message}`);
    process.exit(1);
  }
}
