/**
 * Generates the GovLayer logo PNGs from the same geometry as the in-app mark.
 *
 * Source of truth: `src/components/brand/GovLayerMark.tsx` (the monochrome mark)
 * and `src/app/icon.svg` (the app-icon square). Both are 32x32 viewBox SVG, so
 * these strings mirror them exactly rather than re-drawing anything.
 *
 * Uses `sharp`, which is already present as a Next.js dependency, so this adds
 * nothing to the dependency tree. Not wired into the build: run it by hand when
 * a new size or variant is needed.
 *
 *   node scripts/generate-logo-pngs.mjs
 *
 * Output: `public/brand/`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/brand");

/** Palette, matching `tailwind.config.ts`. */
const INK = "#14151A";
const SURFACE = "#FAF8F4";

/**
 * The mark's shapes, shared by both variants.
 * Kept as data so the icon and the bare mark can never drift apart.
 */
const SHAPES = `
    <path d="M3 7h9" />
    <path d="M3 16h9" />
    <path d="M3 25h9" />
    <path d="M12 7c5 0 5 9 9 9" />
    <path d="M12 25c5 0 5-9 9-9" />
    <path d="M12 16h9" />
    <path d="M26 18.5V29" />`;

/** The bare mark, drawn in one colour on a transparent background. */
function markSvg(size, colour) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
  <g stroke="${colour}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">${SHAPES}
  </g>
  <circle cx="26" cy="16" r="3" fill="${colour}" />
</svg>
`;
}

/**
 * The app-icon square: the mark reversed out of a dark rounded panel, matching
 * `src/app/icon.svg`. Reads on light and dark backgrounds alike.
 */
function squareSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
  <rect width="32" height="32" rx="7" fill="${INK}" />
  <g stroke="${SURFACE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M4 8h8" />
    <path d="M4 16h8" />
    <path d="M4 24h8" />
    <path d="M12 8c4.5 0 4.5 8 8 8" />
    <path d="M12 24c4.5 0 4.5-8 8-8" />
    <path d="M12 16h8" />
    <path d="M25 18.5V28" />
  </g>
  <circle cx="25" cy="16" r="2.8" fill="${SURFACE}" />
</svg>
`;
}

async function render(svg, file) {
  // No `density` override: the SVG carries explicit width/height, so librsvg
  // rasterises at exactly the requested size. Setting density as well would
  // multiply it (density/72) and produce a far larger image than asked for.
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(outDir, file), png);
  const meta = await sharp(png).metadata();
  return `${file}  ${meta.width}x${meta.height}  ${(png.length / 1024).toFixed(1)} kB`;
}

await mkdir(outDir, { recursive: true });

const written = [];

// The app-icon square, at the sizes a favicon, avatar or social card needs.
for (const size of [1024, 512, 256, 128, 64, 32]) {
  const suffix = size === 1024 ? "" : `-${size}`;
  written.push(await render(squareSvg(size), `govlayer-logo${suffix}.png`));
}

// The bare mark on transparency: ink for light backgrounds, surface for dark.
for (const size of [1024, 512, 256]) {
  const suffix = size === 1024 ? "" : `-${size}`;
  written.push(await render(markSvg(size, INK), `govlayer-mark${suffix}.png`));
  written.push(
    await render(markSvg(size, SURFACE), `govlayer-mark-light${suffix}.png`),
  );
}

console.log(`Wrote ${written.length} PNGs to public/brand/`);
for (const line of written) console.log(`  ${line}`);