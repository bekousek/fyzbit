#!/usr/bin/env node
/**
 * Builds the single FyzBit firmware .hex distributed by the web app.
 *
 * There is exactly one firmware file — `public/firmware/fyzbit.hex` — and it
 * is a micro:bit *universal hex*: one file holding two independent board
 * images, of which the board's own DAPLink bootloader keeps only the slice
 * that matches the hardware it is running on.
 *
 *   V1 slice (board id 0x9900) ← fyzbit-v1  build (USB only)
 *   V2 slice (board id 0x9903) ← fyzbit-ble build (USB + Bluetooth UART)
 *
 * So "does this micro:bit speak Bluetooth?" is answered by the hardware at
 * flash time rather than by the user picking a variant, or by a runtime check
 * in the firmware — a runtime check wouldn't help anyway, since V1's problem
 * is that the sensor drivers plus the whole BLE stack don't *fit* (flash and
 * 16 kB RAM), not that they shouldn't run.
 *
 * mkc downloads the MakeCode toolchain + GitHub-hosted sensor drivers on
 * first run, so this needs network access.
 *
 * Run with: node scripts/build-firmware.mjs
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CJS-only package (UMD bundle, no "exports" map) — reachable from ESM only
// through createRequire.
const require = createRequire(import.meta.url);
const {
  createUniversalHex,
  isUniversalHex,
  microbitBoardId,
  separateUniversalHex,
} = require('@microbit/microbit-universal-hex');

const __dirname = dirname(fileURLToPath(import.meta.url));
const firmwareRoot = resolve(__dirname, '..', 'firmware', 'source');
const outDir = resolve(__dirname, '..', 'public', 'firmware');
mkdirSync(outDir, { recursive: true });

/**
 * Builds a project with mkc and returns the single-board Intel hex for
 * `boardId`. mkc writes `mbdal-binary.hex` (V1) and/or `mbcodal-binary.hex`
 * (V2) plus, when it compiled for both, a universal `binary.hex` — take the
 * per-board file when it exists, otherwise unpack the universal one.
 */
function buildBoardHex(projectDir, boardId, perBoardName) {
  console.info(`[build-firmware] building in ${projectDir}`);
  execSync('npx --yes makecode build', { cwd: projectDir, stdio: 'inherit' });

  const perBoard = resolve(projectDir, 'built', perBoardName);
  if (existsSync(perBoard)) {
    console.info(`[build-firmware] using ${perBoard}`);
    return readFileSync(perBoard, 'utf8');
  }

  const universal = resolve(projectDir, 'built', 'binary.hex');
  if (!existsSync(universal)) {
    throw new Error(
      `[build-firmware] neither ${perBoardName} nor binary.hex found in ${projectDir}/built/`,
    );
  }
  const text = readFileSync(universal, 'utf8');
  if (!isUniversalHex(text)) {
    throw new Error(`[build-firmware] ${universal} is not a universal hex`);
  }
  const slice = separateUniversalHex(text).find((p) => p.boardId === boardId);
  if (!slice) {
    throw new Error(
      `[build-firmware] ${universal} has no slice for board 0x${boardId.toString(16)}`,
    );
  }
  console.info(`[build-firmware] using ${universal} (slice 0x${boardId.toString(16)})`);
  return slice.hex;
}

const v1Hex = buildBoardHex(
  resolve(firmwareRoot, 'fyzbit-v1'),
  microbitBoardId.V1,
  'mbdal-binary.hex',
);
const v2Hex = buildBoardHex(
  resolve(firmwareRoot, 'fyzbit-ble'),
  microbitBoardId.V2,
  'mbcodal-binary.hex',
);

const outHex = resolve(outDir, 'fyzbit.hex');
writeFileSync(
  outHex,
  createUniversalHex([
    { hex: v1Hex, boardId: microbitBoardId.V1 },
    { hex: v2Hex, boardId: microbitBoardId.V2 },
  ]),
);
console.info(`[build-firmware] wrote ${outHex}`);
