#!/usr/bin/env node
/**
 * Generates PWA icons from public/icon.svg.
 *
 * - icon-192.png         (192×192, "any" purpose)
 * - icon-512.png         (512×512, "any" purpose)
 * - icon-maskable-512.png (512×512 with safe-area padding, "maskable" purpose)
 *
 * Run with: node scripts/make-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const svg = readFileSync(resolve(publicDir, 'icon.svg'));

await sharp(svg, { density: 384 }).resize(192, 192).png().toFile(resolve(publicDir, 'icon-192.png'));
await sharp(svg, { density: 1024 }).resize(512, 512).png().toFile(resolve(publicDir, 'icon-512.png'));

// Maskable variant: inset the logo by ~10% so the icon shape (circle/squircle
// masks applied by Android etc.) doesn't crop the wordmark.
const MASKABLE = 512;
const INNER = Math.round(MASKABLE * 0.78);
const inner = await sharp(svg, { density: 1024 }).resize(INNER, INNER).png().toBuffer();
await sharp({
  create: {
    width: MASKABLE,
    height: MASKABLE,
    channels: 4,
    background: { r: 27, g: 94, b: 32, alpha: 1 },
  },
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(resolve(publicDir, 'icon-maskable-512.png'));

console.info('PWA icons generated.');
