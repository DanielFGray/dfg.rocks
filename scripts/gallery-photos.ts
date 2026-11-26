#!/usr/bin/env bun
/**
 * Prepares gallery photos for the home page: copies them into `public/gallery/`, compresses them,
 * and prints the `gallery.photos` entries to paste into `app/config.ts`.
 *
 * Usage: bun scripts/gallery-photos.ts <folder> [--consent parent|teacher]
 *
 * The folder holds the photos you gathered from email and messages. Each file becomes one entry.
 * The script compresses in place with ImageMagick, so run it on a copy of your folder if you want
 * to keep the originals untouched.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"]);

const sourceFolder = process.argv[2];
const consentArgIndex = process.argv.indexOf("--consent");
const consent = consentArgIndex === -1 ? "parent" : process.argv[consentArgIndex + 1];

if (!sourceFolder || !existsSync(sourceFolder)) {
  console.error("Usage: bun scripts/gallery-photos.ts <folder> [--consent parent|teacher]");
  console.error(`No such folder: ${sourceFolder ?? "(none given)"}`);
  process.exit(1);
}

const galleryDir = path.join(process.cwd(), "public", "gallery");
if (!existsSync(galleryDir)) {
  console.error("No public/gallery directory. Run this from the project root.");
  process.exit(1);
}

/** A filename that reads as a slug and cannot collide with another photo. */
function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The width and height of an image, via ImageMagick. */
function dimensions(file: string): { width: number; height: number } {
  const out = execFileSync("magick", ["identify", "-format", "%w %h", file], { encoding: "utf8" });
  const [width, height] = out.trim().split(/\s+/).map(Number);
  return { width: width ?? 0, height: height ?? 0 };
}

/** Compresses in place: shrink to fit 1600px on the long edge, then re-encode at quality 82. */
function compress(file: string): void {
  execFileSync("magick", [file, "-resize", "1600x1600>", "-quality", "82", file]);
}

const files = readdirSync(sourceFolder)
  .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  .filter((file) => statSync(path.join(sourceFolder, file)).isFile())
  .sort();

if (files.length === 0) {
  console.error(`No images found in ${sourceFolder}`);
  process.exit(1);
}

const entries: string[] = [];

for (const file of files) {
  const slug = slugify(file) || "photo";
  const target = path.join(galleryDir, `${slug}.jpg`);

  copyFileSync(path.join(sourceFolder, file), target);
  compress(target);

  const { width, height } = dimensions(target);
  const sizeKb = Math.round(statSync(target).size / 1024);

  console.error(`${slug}.jpg  ${width}x${height}  ${sizeKb} KB`);
  entries.push(
    [
      "    {",
      `      src: "/gallery/${slug}.jpg",`,
      `      alt: "", // TODO: describe what is in the photo`,
      `      caption: "", // TODO: one line under the photo`,
      `      consent: "${consent}",`,
      "    },",
    ].join("\n"),
  );
}

console.log("\nPaste into gallery.photos in app/config.ts:\n");
console.log(entries.join("\n"));
