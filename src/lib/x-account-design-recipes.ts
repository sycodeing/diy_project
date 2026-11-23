import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { DesignChoice } from "@/lib/x-account-design-selector";

type Seed = { id: string; version: number; source: string; file: string; sha256: string; allowedProductSlugs: string[] };
type SeedManifest = { schemaVersion: number; designs: Seed[] };
const HASH = /^[a-f0-9]{64}$/;
const ROOT = path.join(process.cwd(), "assets", "account-designs", "v1");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function loadAccountArtwork(choice: Exclude<DesignChoice, { kind: "no_design_match" }>, productSlug: string) {
  if (choice.kind === "procedural") return renderProceduralArtwork(choice);
  const manifest = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8")) as SeedManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.designs)) throw new Error("Design library manifest is invalid");
  const item = manifest.designs.find((row) => row.id === choice.designId);
  if (!item || item.version !== 1 || item.source !== "brand_generated" || !item.allowedProductSlugs?.includes(productSlug)
    || !/^[a-z0-9-]+\.png$/.test(item.file) || !HASH.test(item.sha256))
    throw new Error("Selected original design is unavailable for this product");
  const bytes = new Uint8Array(await readFile(path.join(ROOT, item.file)));
  if (sha(bytes) !== item.sha256) throw new Error("Original design content hash does not match the approved manifest");
  const meta = await sharp(bytes, { failOn: "error", limitInputPixels: 16_000_000 }).metadata();
  if (meta.format !== "png" || !meta.width || !meta.height || meta.width < 600 || meta.height < 600)
    throw new Error("Approved original design is not a valid print image");
  return bytes;
}

/** Reproducible original flat print art; no prospect or quoted media is used. */
export async function renderProceduralArtwork(choice: Extract<DesignChoice, { kind: "procedural" }>) {
  if (choice.colors.length !== 3 || choice.colors.some((color) => !/^#[a-f0-9]{6}$/i.test(color)))
    throw new Error("Design palette is invalid");
  const [background, accent, highlight] = choice.colors;
  const token = createHash("sha256").update(`${choice.recipeId}:${choice.colors.join(",")}:v1`).digest("hex");
  const offset = parseInt(token.slice(0, 2), 16) % 70;
  const family = compositionFamilyForRecipe(choice.recipeId);
  const curves = family === "curves";
  const geometric = family === "geometric";
  const striped = family === "stripes";
  const arched = family === "arches";
  const motif = striped
    ? Array.from({ length: 9 }, (_, index) => `<rect x="${index * 160 - 40}" y="0" width="${index % 3 === 0 ? 92 : 54}" height="1200" fill="${index % 2 ? accent : highlight}" opacity="${index % 3 === 0 ? ".7" : ".5"}"/>`).join("")
    : arched
      ? Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) => {
        const x = col * 280 - 70 + row % 2 * 125;
        const y = row * 320 - 40;
        return `<path d="M${x} ${y + 250} L${x} ${y + 125} A 105 105 0 0 1 ${x + 210} ${y + 125} L${x + 210} ${y + 250} Z" fill="${(row + col) % 2 ? accent : highlight}" opacity=".72"/>`;
      }).join("")).join("")
    : curves
    ? `<path d="M-80 ${140 + offset} C 250 -80 360 400 660 180 S 1060 150 1280 390 M-80 570 C 260 270 380 800 660 520 S 1040 440 1280 730 M-80 930 C 280 620 420 1180 760 850 S 1030 760 1280 1030" fill="none" stroke="${accent}" stroke-width="95" stroke-linecap="round" opacity=".72"/><path d="M-80 390 Q 280 120 600 450 T 1280 410 M-80 790 Q 320 520 690 810 T 1280 780" fill="none" stroke="${highlight}" stroke-width="24" opacity=".7"/>`
    : geometric
      ? Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => `<rect x="${col * 270 - 20 + (row % 2) * 110}" y="${row * 270 - 20}" width="${95 + offset}" height="${95 + offset}" rx="${row % 2 ? 48 : 12}" transform="rotate(${(row + col) % 2 ? 20 : -20} ${col * 270 + 60} ${row * 270 + 60})" fill="${(row + col) % 2 ? accent : highlight}" opacity=".75"/>`).join("")).join("")
      : `<path d="M-120 ${180 + offset} C 250 -30 390 420 760 200 S 1030 160 1320 360 M-120 520 C 210 250 390 760 740 520 S 1080 430 1320 710 M-120 900 C 230 610 420 1130 760 870 S 1080 760 1320 1060" fill="none" stroke="${accent}" stroke-width="135" stroke-linecap="round" opacity=".68"/><circle cx="350" cy="410" r="76" fill="${highlight}" opacity=".9"/><circle cx="850" cy="730" r="112" fill="${highlight}" opacity=".85"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="${background}"/>${motif}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

export function compositionFamilyForRecipe(recipeId: string) {
  if (["black-nouveau", "dark-tonal"].includes(recipeId)) return "curves";
  if (["neutral-white", "black-white-gold"].includes(recipeId)) return "geometric";
  if (["sage", "warm-neutral", "neutral-starter"].includes(recipeId)) return "stripes";
  if (["burnt-orange", "gold-ivory"].includes(recipeId)) return "arches";
  return "waves";
}
