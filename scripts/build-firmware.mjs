#!/usr/bin/env node
/**
 * Builds the FyzBit V1 firmware .hex via the MakeCode CLI (mkc / `makecode`
 * npm package) and copies the result into public/firmware/ so the web app
 * can offer it as a download (and, later, flash it directly over WebUSB).
 *
 * mkc downloads the MakeCode toolchain + GitHub-hosted sensor drivers on
 * first run, so this needs network access. It compiles both micro:bit V1
 * (mbdal) and V2 (mbcodal) images and merges them into a single universal
 * .hex (built/binary.hex) — no separate merge step needed.
 *
 * Run with: node scripts/build-firmware.mjs
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const firmwareDir = resolve(__dirname, '..', 'firmware', 'source', 'fyzbit-v1');
const builtHex = resolve(firmwareDir, 'built', 'binary.hex');
const outDir = resolve(__dirname, '..', 'public', 'firmware');
const outHex = resolve(outDir, 'fyzbit-usb.hex');

console.info(`[build-firmware] building in ${firmwareDir}`);
execSync('npx --yes makecode build', { cwd: firmwareDir, stdio: 'inherit' });

if (!existsSync(builtHex)) {
  throw new Error(`[build-firmware] expected output not found: ${builtHex}`);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(builtHex, outHex);
console.info(`[build-firmware] wrote ${outHex}`);
