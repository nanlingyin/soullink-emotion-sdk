import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileEmbeddingVectorCache } from "../FileEmbeddingVectorCache";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("FileEmbeddingVectorCache", () => {
  it("persists separate provider namespaces without exposing them as file names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "soullink-embedding-cache-"));
    temporaryDirectories.push(directory);
    const cache = new FileEmbeddingVectorCache({ directory });

    expect(await cache.load("https://provider.example:model-a")).toBeNull();
    await cache.save("https://provider.example:model-a", {
      version: 1,
      embeddings: { hello: [1, 0] }
    });

    await expect(cache.load("https://provider.example:model-a")).resolves.toEqual({
      version: 1,
      embeddings: { hello: [1, 0] }
    });
    await expect(cache.load("https://provider.example:model-b")).resolves.toBeNull();
  });
});
