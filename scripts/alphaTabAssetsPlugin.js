import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ALPHATAB_DIST_DIR = path.join(SCRIPT_DIR, "..", "node_modules", "@coderline", "alphatab", "dist");

const ALPHATAB_FILES = [
  "alphaTab.mjs",
  "alphaTab.core.mjs",
  "alphaTab.worker.mjs",
  "alphaTab.worklet.mjs",
];

const ALPHATAB_DIRECTORIES = ["font", "soundfont"];

const CONTENT_TYPES = {
  ".eot": "application/vnd.ms-fontobject",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".sf2": "application/octet-stream",
  ".sf3": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectDirectoryEntries(directoryName, prefix = directoryName) {
  const directoryPath = path.join(ALPHATAB_DIST_DIR, directoryName);
  const entries = [];

  for (const dirent of await readdir(directoryPath, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      entries.push(
        ...(await collectDirectoryEntries(
          path.join(directoryName, dirent.name),
          path.join(prefix, dirent.name),
        )),
      );
      continue;
    }

    if (dirent.isFile()) {
      entries.push({
        fileName: path.join(prefix, dirent.name).replaceAll(path.sep, "/"),
        sourcePath: path.join(directoryPath, dirent.name),
      });
    }
  }

  return entries;
}

async function loadAssetEntries() {
  return [
    ...ALPHATAB_FILES.map((fileName) => ({
      fileName: `alphatab/${fileName}`,
      sourcePath: path.join(ALPHATAB_DIST_DIR, fileName),
    })),
    ...(await Promise.all(ALPHATAB_DIRECTORIES.map((directoryName) => collectDirectoryEntries(directoryName)))).flat(),
  ];
}

function getRequestPath(url) {
  if (!url) {
    return null;
  }

  return decodeURIComponent(url.split("?", 1)[0] || "").replace(/^\/+/, "");
}

async function findGeneratedAsset(assetEntries, publicDir, fileName) {
  if (!fileName) {
    return null;
  }

  if (await exists(path.join(publicDir, fileName))) {
    return null;
  }

  return assetEntries.find((entry) => entry.fileName === fileName) ?? null;
}

function getContentType(fileName) {
  return CONTENT_TYPES[path.extname(fileName)] ?? "application/octet-stream";
}

/** @returns {import("vite").Plugin} */
export function alphaTabAssetsPlugin() {
  let publicDir = null;
  let assetEntriesPromise = null;

  return {
    name: "alphatab-assets",
    configResolved(config) {
      publicDir = path.resolve(config.root, config.publicDir);
      assetEntriesPromise ??= loadAssetEntries();
    },
    async configureServer(server) {
      const assetEntries = await (assetEntriesPromise ??= loadAssetEntries());

      server.middlewares.use(async (req, res, next) => {
        try {
          const asset = await findGeneratedAsset(assetEntries, publicDir, getRequestPath(req.url));
          if (!asset) {
            next();
            return;
          }

          res.setHeader("Content-Type", getContentType(asset.fileName));
          res.end(await readFile(asset.sourcePath));
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      const assetEntries = await (assetEntriesPromise ??= loadAssetEntries());

      for (const asset of assetEntries) {
        if (await exists(path.join(publicDir, asset.fileName))) {
          continue;
        }

        this.emitFile({
          fileName: asset.fileName,
          source: await readFile(asset.sourcePath),
          type: "asset",
        });
      }
    },
  };
}
