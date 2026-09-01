/**
 * Where the firmware lives. Its own module because ConnectionModal needs the
 * URL (for the manual-download fallback) but must not pull in Flasher.ts —
 * that would drag @microbit/microbit-connection into the main bundle, which
 * is precisely what the dynamic import in ConnectionModal.startFlash() avoids.
 *
 * One file, both boards: see scripts/build-firmware.mjs.
 */
export const FIRMWARE_HEX_URL = `${import.meta.env.BASE_URL}firmware/fyzbit.hex`;
