import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "../assertEnv.js";

export type StorageBackend = "local";

export type StorageLocation = {
  storageBackend: string;
  storageKey: string;
};

const uploadsDir = env.UPLOADS_DIR || "./uploads";

await fs.mkdir(uploadsDir, { recursive: true });

function resolveLocalPath(storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(uploadsDir, storageKey);
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export const storageService = {
  hashBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  },

  createMaterialLocation(contentHash: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join("materials", contentHash.slice(0, 2), contentHash),
    };
  },

  createTestingLocation(filename: string): StorageLocation {
    return {
      storageBackend: "local",
      storageKey: path.posix.join("test", `${randomUUID()}${getExtension(filename)}`),
    };
  },

  async exists(location: StorageLocation): Promise<boolean> {
    if (location.storageBackend !== "local") {
      throw new Error(`Unsupported storage backend: ${location.storageBackend}`);
    }

    try {
      await fs.access(resolveLocalPath(location.storageKey));
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  },

  async put(location: StorageLocation, bytes: Uint8Array): Promise<void> {
    if (location.storageBackend !== "local") {
      throw new Error(`Unsupported storage backend: ${location.storageBackend}`);
    }

    const filePath = resolveLocalPath(location.storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
  },

  async delete(location: StorageLocation): Promise<void> {
    if (location.storageBackend !== "local") {
      throw new Error(`Unsupported storage backend: ${location.storageBackend}`);
    }

    await fs.unlink(resolveLocalPath(location.storageKey));
  },

  async open(location: StorageLocation): Promise<ReadableStream<Uint8Array>> {
    if (location.storageBackend !== "local") {
      throw new Error(`Unsupported storage backend: ${location.storageBackend}`);
    }

    const nodeStream = createReadStream(resolveLocalPath(location.storageKey));
    return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  },
} as const;
