import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveDemoAssetLayout } from "./demo-assets.mjs";

test("prefers the configured public model root", async () => {
  const root = await mkdtemp(join(tmpdir(), "soullink-assets-"));
  try {
    await mkdir(join(root, "custom", "public", "models"), { recursive: true });
    await mkdir(join(root, "l2d"), { recursive: true });
    assert.deepEqual(resolveDemoAssetLayout(root, "custom/public"), {
      publicDir: resolve(root, "custom/public"),
      modelsRoot: resolve(root, "custom/public/models"),
      modelsBaseUrl: "/models",
      usePublicModels: true
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back to the legacy l2d model root", async () => {
  const root = await mkdtemp(join(tmpdir(), "soullink-assets-"));
  try {
    await mkdir(join(root, "l2d"), { recursive: true });
    const layout = resolveDemoAssetLayout(root, "missing/public");
    assert.equal(layout.modelsRoot, resolve(root, "l2d"));
    assert.equal(layout.modelsBaseUrl, "/l2d");
    assert.equal(layout.usePublicModels, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
