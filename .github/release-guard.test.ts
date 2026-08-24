import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import pkg from "../package.json";
import {
  EXPECTED_REPOSITORY,
  assertRuntimeMinimums,
  compareNumericVersions,
  validatePackReport,
  validateRelease,
} from "./release-guard.mjs";

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
  const valid = {
    refType: "tag",
    refName: "v0.4.0-v9.0",
    pkg,
  };

  test("accepts only the exact package tag and fixed channel", () => {
    expect(validateRelease(valid)).toEqual({
      version: "0.4.0-v9.0",
      distTag: "ledger-v9",
      tag: "v0.4.0-v9.0",
    });
  });

  test("rejects branch, stable, non-v9, malformed, and mismatched tags", () => {
    expect(() => validateRelease({ ...valid, refType: "branch" })).toThrow(/Git tag/);
    for (const version of ["0.4.0", "0.4.0-rc.1", "0.4.0-v9", "0.4.0-v9.01"]) {
      expect(() =>
        validateRelease({
          ...valid,
          refName: `v${version}`,
          pkg: { ...pkg, version },
        }),
      ).toThrow(/full -v9\.N prerelease/);
    }
    for (const refName of ["0.4.0-v9.0", "v0.4.0", "v0.4.0-v9.1", "v9.0"]) {
      expect(() => validateRelease({ ...valid, refName })).toThrow(/does not exactly match/);
    }
  });

  test("rejects any repository metadata mismatch", () => {
    expect(pkg.repository).toEqual(EXPECTED_REPOSITORY);
    expect(() =>
      validateRelease({
        ...valid,
        pkg: { ...pkg, repository: { ...pkg.repository, url: "https://github.com/fork/repo.git" } },
      }),
    ).toThrow(/repository metadata/);
  });
});

describe("pack guard", () => {
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

  test("accepts the exact package identity and all export targets", () => {
    expect(
      validatePackReport([{ name: pkg.name, version: pkg.version, files }], pkg),
    ).toEqual({ name: pkg.name, version: pkg.version, fileCount: files.length });
  });

  test("rejects missing exports, wrong identity, forbidden files, and multi-package output", () => {
    expect(() => validatePackReport([], pkg)).toThrow(/exactly one/);
    expect(() =>
      validatePackReport([{ name: pkg.name, version: "0.3.0", files }], pkg),
    ).toThrow(/does not match/);
    expect(() =>
      validatePackReport(
        [{ name: pkg.name, version: pkg.version, files: files.slice(0, -2) }],
        pkg,
      ),
    ).toThrow(/missing export target/);
    expect(() =>
      validatePackReport(
        [{ name: pkg.name, version: pkg.version, files: [...files, { path: ".github/x" }] }],
        pkg,
      ),
    ).toThrow(/forbidden files/);
  });
});

describe("publish workflow", () => {
  test("is tag-only, least-privilege, ordered, and has one exact publish command", () => {
    const workflow = readFileSync(new URL("./workflows/publish.yml", import.meta.url), "utf8");
    expect(workflow).toContain('      - "v*-v9.*"');
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
    expect(workflow.match(/npm publish/g)?.length).toBe(1);
    expect(workflow).toContain("npm publish --access public --tag ledger-v9");

    const ordered = [
      "release-guard.mjs release",
      "bun install --frozen-lockfile",
      "bun run build",
      "bun test",
      "npm pack --dry-run --json",
      "npm publish --access public --tag ledger-v9",
    ].map((needle) => workflow.indexOf(needle));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });
});
