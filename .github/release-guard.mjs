import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RELEASE_DIST_TAG = "ledger-v9";
export const EXPECTED_REPOSITORY = Object.freeze({
  type: "git",
  url: "https://github.com/effectstream/mip-zswap-offer.git",
});

const FULL_V9_PRERELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-v9\.(0|[1-9]\d*)$/;

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

export function validateRelease({ refType, refName, pkg }) {
  if (refType !== "tag") {
    throw new Error(`Publish requires a Git tag ref, received ${refType || "missing"}`);
  }
  if (!FULL_V9_PRERELEASE.test(pkg.version)) {
    throw new Error(`Package version ${pkg.version} is not a full -v9.N prerelease`);
  }
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
  return { version: pkg.version, distTag: RELEASE_DIST_TAG, tag: expectedTag };
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
  return { name: packed.name, version: packed.version, fileCount: paths.size };
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
      console.log(
        `Release guard satisfied: ${result.tag} -> ${result.version} on ${result.distTag}`,
      );
    } else if (command === "pack") {
      const report = JSON.parse(readFileSync(args[0], "utf8"));
      const result = validatePackReport(report, packageJson());
      console.log(
        `Pack guard satisfied: ${result.name}@${result.version}, ${result.fileCount} files`,
      );
    } else {
      throw new Error("Usage: release-guard.mjs <runtime NODE NPM|release|pack REPORT_JSON>");
    }
  } catch (error) {
    console.error(`release guard failed: ${error.message}`);
    process.exit(1);
  }
}
