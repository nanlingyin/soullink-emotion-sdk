import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddingVectorCache, EmbeddingVectorCacheEntry } from "./types";

export interface FileEmbeddingVectorCacheOptions {
  directory: string;
}

export class FileEmbeddingVectorCache implements EmbeddingVectorCache {
  readonly directory: string;

  constructor(options: FileEmbeddingVectorCacheOptions) {
    if (!options.directory.trim()) throw new Error("FileEmbeddingVectorCache requires a directory");
    this.directory = options.directory;
  }

  async load(namespace: string): Promise<EmbeddingVectorCacheEntry | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath(namespace), "utf8")) as unknown;
      return isCacheEntry(parsed) ? parsed : null;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(namespace: string, entry: EmbeddingVectorCacheEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.filePath(namespace), JSON.stringify(entry), "utf8");
  }

  private filePath(namespace: string): string {
    const name = createHash("sha256").update(namespace).digest("hex");
    return join(this.directory, `${name}.json`);
  }
}

function isCacheEntry(value: unknown): value is EmbeddingVectorCacheEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Boolean(record.embeddings) && typeof record.embeddings === "object";
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
