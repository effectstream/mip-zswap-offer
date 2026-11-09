import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";
import {
  EXPECTED_REPOSITORY,
  PRERELEASE_DIST_TAG,
  STABLE_DIST_TAG,
  assertRuntimeMinimums,
  compareNumericVersions,
  decidePublishOutcome,
  distTagForVersion,
  validatePackReport,
  validateRelease,
  verifyPublished,
  writeGithubOutput,
} from "./release-guard.mjs";

const GUARD = fileURLToPath(new URL("./release-guard.mjs", import.meta.url));

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "release-guard-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGuard(args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, GUARD, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("runtime minimums", () => {
  test("compares numeric versions without unsafe-number truncation", () => {
    expect(compareNumericVersions("v22.14.0", "22.14.0")).toBe(0);
    expect(compareNumericVersions("22.14", "22.14.0")).toBe(0);
    expect(compareNumericVersions("9007199254740993.0.0", "9007199254740992.99.99")).toBe(1);
  });

  test("accepts exact/newer Node and npm and rejects either old runtime", () => {
    expect(() => assertRuntimeMinimums("22.14.0", "11.5.1")).not.toThrow();
    expect(() => assertRuntimeMinimums("24.0.0", "11.9.0")).not.toThrow();
    expect(() => assertRuntimeMinimums("22.13.9", "11.9.0")).toThrow(/Node/);
    expect(() => assertRuntimeMinimums("24.0.0", "11.5.0")).toThrow(/npm/);
  });
});

describe("release guard", () => {
  const release = (version: string, refName = `v${version}`) =>
    validateRelease({ refType: "tag", refName, pkg: { ...pkg, version } });

  test("publishes a stable version to latest", () => {
    expect(STABLE_DIST_TAG).toBe("latest");
    expect(release("0.4.0")).toEqual({ version: "0.4.0", distTag: "latest", tag: "v0.4.0" });
    expect(release("1.10.20").distTag).toBe("latest");
  });

  test("publishes a prerelease version to next", () => {
    expect(PRERELEASE_DIST_TAG).toBe("next");
    expect(release("0.4.1-rc.1")).toEqual({
      version: "0.4.1-rc.1",
      distTag: "next",
      tag: "v0.4.1-rc.1",
    });
    for (const version of ["1.0.0-alpha", "0.5.0-beta.2", "0.4.1-0", "0.4.1-x.7.z.92"]) {
      expect(release(version).distTag).toBe("next");
    }
  });

  test("accepts the checked-in package version on its own tag", () => {
    expect(validateRelease({ refType: "tag", refName: `v${pkg.version}`, pkg })).toEqual({
      version: pkg.version,
      distTag: distTagForVersion(pkg.version),
      tag: `v${pkg.version}`,
    });
  });

  test("rejects the retired -v9.N prerelease scheme", () => {
    for (const version of ["0.4.0-v9.0", "0.4.0-v9.1", "0.4.1-v9", "0.4.1-v9.2.rc"]) {
      expect(() => release(version)).toThrow(/retired -v9\.N/);
    }
  });

  test("rejects versions that are not plain semver", () => {
    for (const version of [
      "",
      "0.4",
      "0.4.0.1",
      "v0.4.0",
      "00.4.0",
      "0.04.0",
      "0.4.0-",
      "0.4.0-rc.01",
      "0.4.0+build.1",
      "0.4.0-rc.1+build",
    ]) {
      expect(() => release(version)).toThrow(/not a valid semver/);
    }
  });

  test("rejects non-tag refs and tags that are not exactly v<version>", () => {
    expect(() => validateRelease({ refType: "branch", refName: "main", pkg })).toThrow(/Git tag/);
    expect(() =>
      validateRelease({ refType: undefined, refName: `v${pkg.version}`, pkg }),
    ).toThrow(/Git tag/);
    for (const [version, refName] of [
      ["0.4.0", "v0.4.1"],
      ["0.4.1", "v0.4.0"],
      ["0.4.0", "0.4.0"],
      ["0.4.0", "v0.4.0-rc.1"],
      ["0.4.1-rc.1", "v0.4.1"],
      ["0.4.0", "refs/tags/v0.4.0"],
      ["0.4.0", ""],
    ]) {
      expect(() => release(version, refName)).toThrow(/does not exactly match/);
    }
  });

  test("rejects any repository metadata mismatch", () => {
    expect(pkg.repository).toEqual(EXPECTED_REPOSITORY);
    expect(() =>
      validateRelease({
        refType: "tag",
        refName: `v${pkg.version}`,
        pkg: { ...pkg, repository: { ...pkg.repository, url: "https://github.com/fork/repo.git" } },
      }),
    ).toThrow(/repository metadata/);
  });
});

describe("release command", () => {
  test("writes the dist-tag to GITHUB_OUTPUT and prints the summary", () => {
    withTempDir((dir) => {
      const output = join(dir, "github-output");
      writeFileSync(output, "earlier=1\n");
      const result = runGuard(["release"], {
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: `v${pkg.version}`,
        GITHUB_OUTPUT: output,
      });
      const distTag = distTagForVersion(pkg.version);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(`earlier=1\ndist_tag=${distTag}\n`);
      expect(result.stdout).toContain(`v${pkg.version} -> ${pkg.version} on ${distTag}`);
    });
  });

  test("fails on a mismatched tag without writing an output", () => {
    withTempDir((dir) => {
      const output = join(dir, "github-output");
      writeFileSync(output, "");
      const result = runGuard(["release"], {
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v999.0.0",
        GITHUB_OUTPUT: output,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/does not exactly match/);
      expect(readFileSync(output, "utf8")).toBe("");
    });
  });

  test("output writer skips a missing path and refuses multi-line values", () => {
    expect(() => writeGithubOutput({ dist_tag: "latest" }, "")).not.toThrow();
    withTempDir((dir) => {
      expect(() =>
        writeGithubOutput({ dist_tag: "latest\nother=1" }, join(dir, "github-output")),
      ).toThrow(/single line/);
    });
  });
});

const files = [
  "package.json",
  "README.md",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/mip5/index.js",
  "dist/mip5/index.d.ts",
  "dist/mip6/index.js",
  "dist/mip6/index.d.ts",
  "src/index.ts",
].map((path) => ({ path }));
const localIntegrity = `sha512-${"L".repeat(86)}==`;
const otherIntegrity = `sha512-${"O".repeat(86)}==`;
const packed = {
  name: pkg.name,
  version: pkg.version,
  filename: `effectstream-mip-zswap-offer-${pkg.version}.tgz`,
  integrity: localIntegrity,
  files,
};

describe("pack guard", () => {
  test("accepts the exact package identity and all export targets", () => {
    expect(validatePackReport([packed], pkg)).toEqual({
      name: pkg.name,
      version: pkg.version,
      fileCount: files.length,
      integrity: localIntegrity,
      filename: packed.filename,
    });
  });

  test("rejects missing exports, wrong identity, forbidden files, and multi-package output", () => {
    expect(() => validatePackReport([], pkg)).toThrow(/exactly one/);
    expect(() => validatePackReport([packed, packed], pkg)).toThrow(/exactly one/);
    expect(() => validatePackReport([{ ...packed, version: "0.3.0" }], pkg)).toThrow(
      /does not match/,
    );
    expect(() =>
      validatePackReport([{ ...packed, files: files.slice(0, -2) }], pkg),
    ).toThrow(/missing export target/);
    expect(() =>
      validatePackReport([{ ...packed, files: [...files, { path: ".github/x" }] }], pkg),
    ).toThrow(/forbidden files/);
  });

  test("rejects a report without the tarball integrity", () => {
    expect(() => validatePackReport([{ ...packed, integrity: undefined }], pkg)).toThrow(
      /integrity/,
    );
    expect(() => validatePackReport([{ ...packed, integrity: "" }], pkg)).toThrow(/integrity/);
  });

  test("rejects a report without a plain .tgz filename", () => {
    for (const filename of [undefined, "", "pack/x.tgz", "..\\x.tgz", "x.tar"]) {
      expect(() => validatePackReport([{ ...packed, filename }], pkg)).toThrow(/filename/);
    }
  });
});

describe("publish outcome", () => {
  test("a zero publish exit passes", () => {
    expect(
      decidePublishOutcome({ publishExitCode: 0, localIntegrity, registryIntegrity: "" }).ok,
    ).toBe(true);
  });

  test("a failed publish passes only when the registry serves the identical tarball", () => {
    const same = decidePublishOutcome({
      publishExitCode: 1,
      localIntegrity,
      registryIntegrity: localIntegrity,
    });
    expect(same.ok).toBe(true);
    expect(same.reason).toMatch(/identical integrity/);
  });

  test("a failed publish fails when the registry does not serve the version", () => {
    const missing = decidePublishOutcome({
      publishExitCode: 1,
      localIntegrity,
      registryIntegrity: "",
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/does not serve/);
  });

  test("a failed publish fails when the registry serves a different tarball", () => {
    const different = decidePublishOutcome({
      publishExitCode: 1,
      localIntegrity,
      registryIntegrity: otherIntegrity,
    });
    expect(different.ok).toBe(false);
    expect(different.reason).toMatch(/different tarball/);
  });

  test("a failed publish fails when the local integrity is unknown", () => {
    for (const registryIntegrity of ["", otherIntegrity]) {
      const unknown = decidePublishOutcome({
        publishExitCode: 1,
        localIntegrity: "",
        registryIntegrity,
      });
      expect(unknown.ok).toBe(false);
      expect(unknown.reason).toMatch(/local tarball integrity/);
    }
  });

  test("rejects an invalid exit code", () => {
    for (const publishExitCode of [Number.NaN, -1, 1.5, undefined]) {
      expect(() =>
        decidePublishOutcome({
          publishExitCode: publishExitCode as number,
          localIntegrity,
          registryIntegrity: localIntegrity,
        }),
      ).toThrow(/exit code/);
    }
  });
});

describe("publish verification", () => {
  const reads = (values: string[]) => {
    const calls: string[] = [];
    let index = 0;
    const readIntegrity = (name: string, version: string) => {
      calls.push(`${name}@${version}`);
      return values[Math.min(index++, values.length - 1)];
    };
    return { calls, readIntegrity };
  };

  test("re-reads the registry until the version appears", async () => {
    const registry = reads(["", "", localIntegrity]);
    const outcome = await verifyPublished({
      report: [packed],
      pkg,
      publishExitCode: 1,
      readIntegrity: registry.readIntegrity,
      attempts: 5,
      delayMs: 0,
    });
    expect(outcome.ok).toBe(true);
    expect(registry.calls).toEqual(Array(3).fill(`${pkg.name}@${pkg.version}`));
  });

  test("fails at once on a different integrity", async () => {
    const registry = reads([otherIntegrity, localIntegrity]);
    const outcome = await verifyPublished({
      report: [packed],
      pkg,
      publishExitCode: 1,
      readIntegrity: registry.readIntegrity,
      attempts: 5,
      delayMs: 0,
    });
    expect(outcome.ok).toBe(false);
    expect(registry.calls.length).toBe(1);
  });

  test("fails after the last read when the version never appears", async () => {
    const registry = reads([""]);
    const outcome = await verifyPublished({
      report: [packed],
      pkg,
      publishExitCode: 1,
      readIntegrity: registry.readIntegrity,
      attempts: 3,
      delayMs: 0,
    });
    expect(outcome.ok).toBe(false);
    expect(registry.calls.length).toBe(3);
  });

  test("refuses a pack report without integrity before reading the registry", async () => {
    const registry = reads([""]);
    await expect(
      verifyPublished({
        report: [{ ...packed, integrity: "" }],
        pkg,
        publishExitCode: 1,
        readIntegrity: registry.readIntegrity,
        attempts: 1,
        delayMs: 0,
      }),
    ).rejects.toThrow(/integrity/);
    expect(registry.calls.length).toBe(0);
  });
});

describe("verify-published command", () => {
  // A stand-in `npm` on PATH answers `npm view` the way the registry would.
  function verifyWithRegistry(
    npmStdout: string,
    npmExitCode: number,
    exitArg: string[] = ["1"],
  ) {
    return withTempDir((dir) => {
      const npm = join(dir, "npm");
      const log = join(dir, "npm-args.log");
      writeFileSync(
        npm,
        '#!/bin/sh\necho "$@" >> "$FAKE_NPM_LOG"\nprintf "%s\\n" "$FAKE_NPM_STDOUT"\nexit "$FAKE_NPM_EXIT"\n',
      );
      chmodSync(npm, 0o755);
      const report = join(dir, "pack-report.json");
      writeFileSync(report, JSON.stringify([packed]));
      const result = runGuard(["verify-published", report, ...exitArg], {
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        FAKE_NPM_LOG: log,
        FAKE_NPM_STDOUT: npmStdout,
        FAKE_NPM_EXIT: String(npmExitCode),
        VERIFY_PUBLISHED_ATTEMPTS: "2",
        VERIFY_PUBLISHED_DELAY_MS: "0",
      });
      let npmArgs = "";
      try {
        npmArgs = readFileSync(log, "utf8");
      } catch {}
      return { ...result, npmArgs };
    });
  }

  test("passes when the registry serves the identical integrity", () => {
    const result = verifyWithRegistry(JSON.stringify(localIntegrity), 0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/identical integrity/);
    expect(result.npmArgs).toContain(`view ${pkg.name}@${pkg.version} dist.integrity --json`);
  });

  test("fails when the registry reports the version as missing", () => {
    const result = verifyWithRegistry('{"error":{"code":"E404"}}', 1);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/does not serve/);
    expect(result.npmArgs.trim().split("\n").length).toBe(2);
  });

  test("fails when the registry serves a different integrity", () => {
    const result = verifyWithRegistry(JSON.stringify(otherIntegrity), 0);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/different tarball/);
  });

  test("fails without the publish exit code argument", () => {
    const result = verifyWithRegistry(JSON.stringify(localIntegrity), 0, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/needs the npm publish exit code/);
    expect(result.npmArgs).toBe("");
  });
});

describe("publish workflow", () => {
  test("is tag-only, least-privilege, ordered, and publishes the guarded tarball once", () => {
    const workflow = readFileSync(new URL("./workflows/publish.yml", import.meta.url), "utf8");
    expect(workflow).toContain('      - "v*"');
    expect(workflow).not.toContain("workflow_dispatch");
    expect(workflow).toContain("  contents: read");
    expect(workflow).toContain("  id-token: write");
    expect(workflow).toContain("    runs-on: ubuntu-24.04");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6",
    );
    expect(workflow).toContain(
      "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6",
    );
    expect(workflow).toContain(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2",
    );
    expect(workflow).toContain('node-version: "24.19.0"');
    expect(workflow).toContain("bun-version: 1.4.0");
    expect(workflow).not.toContain("bun-version: latest");
    for (const uses of workflow.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)) {
      expect(uses[1]).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).toContain("DIST_TAG: ${{ steps.guard.outputs.dist_tag }}");
    expect(workflow).toContain("TARBALL_NAME: ${{ steps.pack.outputs.filename }}");
    expect(workflow.match(/npm publish/g)?.length).toBe(1);
    expect(workflow).toContain('npm publish "$TARBALL" --access public --tag "$DIST_TAG"');
    expect(workflow).not.toMatch(/--tag (latest|next|ledger-v9)/);

    const ordered = [
      "id: guard",
      "release-guard.mjs release",
      "bun install --frozen-lockfile",
      "bun run build",
      "bun test",
      "id: pack",
      'npm pack --pack-destination "$RUNNER_TEMP/pack" --json',
      "release-guard.mjs pack",
      'npm publish "$TARBALL"',
      "release-guard.mjs verify-published",
    ].map((needle) => workflow.indexOf(needle));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });
});
