#!/usr/bin/env node
/**
 * Builds both FyzBit firmware .hex files via the MakeCode CLI (mkc /
 * `makecode` npm package) and copies them into public/firmware/ so the web
 * app can offer them as downloads and flash them directly over WebUSB.
 *
 * mkc downloads the MakeCode toolchain + GitHub-hosted sensor drivers on
 * first run, so this needs network access.
 *
 *   fyzbit-v1  → fyzbit-usb.hex     universal hex, V1 (mbdal) + V2 (mbcodal)
 *   fyzbit-ble → fyzbit-ble-v2.hex  V2 (mbcodal) image only, deliberately —
 *                                   the project actually compiles fine for V1
 *                                   too (with the "no pairing" Bluetooth
 *                                   config; without it V1 misses the flash
 *                                   budget by ~3 KB), but V1's 16 KB RAM
 *                                   running sensors + full BLE stack at once
 *                                   hasn't been runtime-tested, so we only
 *                                   ship what fyzbit-ble/README.md documents:
 *                                   V2. Pick the variant-specific hex, not
 *                                   the merged universal one.
 *
 * Run with: node scripts/build-firmware.mjs
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const firmwareRoot = resolve(__dirname, '..', 'firmware', 'source');
const outDir = resolve(__dirname, '..', 'public', 'firmware');
mkdirSync(outDir, { recursive: true });

function buildProject(projectDir, outName, hexCandidates) {
  console.info(`[build-firmware] building in ${projectDir}`);
  execSync('npx --yes makecode build', { cwd: projectDir, stdio: 'inherit' });

  const builtHex = hexCandidates
    .map((name) => resolve(projectDir, 'built', name))
    .find((p) => existsSync(p));
  if (!builtHex) {
    throw new Error(`[build-firmware] no built hex found in ${projectDir}/built/`);
  }

  const outHex = resolve(outDir, outName);
  copyFileSync(builtHex, outHex);
  console.info(`[build-firmware] wrote ${outHex} (from ${builtHex})`);
}

// fyzbit-v1: universal hex covering both boards.
buildProject(resolve(firmwareRoot, 'fyzbit-v1'), 'fyzbit-usb.hex', [
  'binary.hex',
  'mbcodal-binary.hex',
  'mbdal-binary.hex',
]);
// fyzbit-ble: V2-only by design — see the comment above.
buildProject(resolve(firmwareRoot, 'fyzbit-ble'), 'fyzbit-ble-v2.hex', [
  'mbcodal-binary.hex',
]);
