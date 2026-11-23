/**
 * Rewrites class strings in app/ for colour tokens that change value in dark mode
 * (app/styles.css). Run from the repo root: `bun scripts/colour-tokens-codemod.ts`.
 *
 * 1. `dark:…-muted-dark` becomes `dark:…-muted`. Inside dark mode both name the same colour,
 *    so this is always equivalent.
 * 2. A `dark:` class is then deleted when the same string literal holds the identical class
 *    without `dark:`, because the light class already gives that colour in dark mode.
 *
 * The script changes only string literals, and it can run again on a file it already changed.
 */
import { Glob } from "bun";

const tokens = ["surface", "card", "primary", "muted", "overlay"];
const darkSuffix = new RegExp(`-(${tokens.join("|")})-dark(?=/|$)`);
// A JSX attribute string can span lines, so double quotes may hold newlines.
const quotedString = /"[^"]*"|'[^'\n]*'/g;
const templateLiteral = /`[^`]*`/g;
const templateText = /(?<=^`|\})[^`$}]+(?=`|\$\{)/g;

let changedFiles = 0;
for await (const path of new Glob("app/**/*.{ts,tsx}").scan(".")) {
  const source = await Bun.file(path).text();
  // Quoted strings first, including those nested in a template's `${…}`; then the static
  // text of each template literal, between its `${…}` expressions.
  const rewritten = source
    .replace(quotedString, (q) => q[0] + rewriteLiteral(q.slice(1, -1)) + q.at(-1))
    .replace(templateLiteral, (t) => t.replace(templateText, rewriteLiteral));
  if (rewritten !== source) {
    await Bun.write(path, rewritten);
    changedFiles++;
  }
}
console.log(`colour-tokens-codemod: rewrote ${changedFiles} files`);

function rewriteLiteral(text: string): string {
  const parts = text.split(/(\s+)/);
  const renamed = parts.map((part) => {
    const variants = splitVariants(part);
    if (!variants.includes("dark") || !darkSuffix.test(part)) return part;
    return part.replace(darkSuffix, "-$1");
  });
  const present = new Set(renamed);
  const kept = renamed.map((part) => {
    const variants = splitVariants(part);
    if (!variants.includes("dark")) return part;
    const lightTwin = variants.filter((v) => v !== "dark").join(":");
    return isTokenClass(part) && present.has(lightTwin) ? null : part;
  });
  return joinParts(kept);
}

/** Splits `dark:hover:text-muted` on colons that are not inside an arbitrary `[…]` variant. */
function splitVariants(cls: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) {
      out.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  out.push(cls.slice(start));
  return out;
}

function isTokenClass(cls: string): boolean {
  const utility = splitVariants(cls).at(-1)!;
  return tokens.some((t) => new RegExp(`-${t}(/[\\d.]+)?$`).test(utility));
}

/** Joins the literal again, dropping deleted classes and one whitespace run next to each. */
function joinParts(parts: (string | null)[]): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== null) {
      out.push(parts[i]!);
      continue;
    }
    // parts alternate class, whitespace, class…; drop the whitespace before the class,
    // or after it when the class leads the literal.
    if (out.length > 1 && /^\s+$/.test(out.at(-1)!)) out.pop();
    else if (i + 1 < parts.length && /^\s+$/.test(parts[i + 1] ?? "")) i++;
  }
  return out.join("");
}
