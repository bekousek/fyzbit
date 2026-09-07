#!/usr/bin/env node
/**
 * Generates every raster icon and the social card from public/icon.svg.
 *
 * - favicon.ico          (16/32/48, PNG-in-ICO — what browsers request by
 *                         default when nothing else matches)
 * - favicon-32.png       (32×32, the modern <link rel="icon">)
 * - apple-touch-icon.png (180×180, opaque — iOS applies its own mask)
 * - icon-192.png         (192×192, "any" purpose)
 * - icon-512.png         (512×512, "any" purpose)
 * - icon-maskable-512.png (512×512 with safe-area padding, "maskable")
 * - og-image.png         (1200×630 social card)
 *
 * Run with: node scripts/make-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const svg = readFileSync(resolve(publicDir, 'icon.svg'));

const GREEN = { r: 27, g: 94, b: 32, alpha: 1 };
const out = (name) => resolve(publicDir, name);

// ── PWA icons ────────────────────────────────────────────────────────────
await sharp(svg, { density: 384 }).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg, { density: 1024 }).resize(512, 512).png().toFile(out('icon-512.png'));

// Maskable variant: inset the logo by ~10% so the icon shape (circle/squircle
// masks applied by Android etc.) doesn't crop the wordmark.
const MASKABLE = 512;
const INNER = Math.round(MASKABLE * 0.78);
const inner = await sharp(svg, { density: 1024 }).resize(INNER, INNER).png().toBuffer();
await sharp({
  create: { width: MASKABLE, height: MASKABLE, channels: 4, background: GREEN },
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('icon-maskable-512.png'));

// ── Favicons ─────────────────────────────────────────────────────────────
await sharp(svg, { density: 512 }).resize(32, 32).png().toFile(out('favicon-32.png'));

// iOS never respects transparency here — it composites onto white, which would
// leave a white halo around the rounded corners. Flatten onto the brand green.
await sharp(svg, { density: 1024 })
  .resize(180, 180)
  .flatten({ background: GREEN })
  .png()
  .toFile(out('apple-touch-icon.png'));

/**
 * Minimal ICO writer. The format is a 6-byte header, one 16-byte directory
 * entry per image, then the image payloads — and every browser that still
 * asks for /favicon.ico accepts PNG payloads, so no BMP encoding is needed.
 */
async function writeIco(sizes, file) {
  const images = await Promise.all(
    sizes.map((s) => sharp(svg, { density: 512 }).resize(s, s).png().toBuffer()),
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = images.map((img, i) => {
    const e = Buffer.alloc(16);
    // 0 means 256 in this field; none of our sizes reach it, but be correct.
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0);
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
    e.writeUInt8(0, 2); // palette colors
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });
  writeFileSync(file, Buffer.concat([header, ...entries, ...images]));
}

await writeIco([16, 32, 48], out('favicon.ico'));

// ── Open Graph card ──────────────────────────────────────────────────────
// Drawn as its own SVG rather than by scaling the app icon: a 1200×630 card
// is read at thumbnail size in a chat window, so it needs the name and the
// one-line pitch, not a blown-up "Fy".
const OG_W = 1200;
const OG_H = 630;
const ogSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1B5E20"/>
      <stop offset="100%" stop-color="#0F3812"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
  <g fill="none" stroke="#66BB6A" stroke-width="6" stroke-linecap="round" opacity="0.55">
    <path d="M90 470 C 220 470, 260 300, 380 300 S 560 180, 700 180"/>
  </g>
  <g fill="#66BB6A" opacity="0.75">
    <circle cx="380" cy="300" r="12"/>
    <circle cx="700" cy="180" r="12"/>
    <circle cx="90" cy="470" r="12"/>
  </g>
  <text x="90" y="200" font-family="Segoe UI, Roboto, DejaVu Sans, sans-serif"
        font-size="104" font-weight="700" fill="#FFFFFF">FyzBit</text>
  <text x="92" y="268" font-family="Segoe UI, Roboto, DejaVu Sans, sans-serif"
        font-size="40" font-weight="600" fill="#C8E6C9">Fyzika na micro:bitu</text>
  <text x="92" y="556" font-family="Segoe UI, Roboto, DejaVu Sans, sans-serif"
        font-size="30" fill="#E8EFE9">Datalogger v prohlížeči · teplota, vzdálenost, síla, tlak, vlhkost</text>
  <text x="92" y="600" font-family="Segoe UI, Roboto, DejaVu Sans, sans-serif"
        font-size="28" fill="#A5D6A7">Bez instalace · bez programování · zdarma pro ZŠ a SŠ</text>
</svg>`);
await sharp(ogSvg).png().toFile(out('og-image.png'));

console.info('Icons, favicons and the Open Graph card generated.');
