import type { ProgressStage } from '@microbit/microbit-connection';
import { createUSBConnection } from '@microbit/microbit-connection/usb';
import { createUniversalHexFlashDataSource } from '@microbit/microbit-connection/universal-hex';

export type FirmwareVariant = 'usb' | 'ble';

const FIRMWARE_HEX_URL: Record<FirmwareVariant, string> = {
  usb: `${import.meta.env.BASE_URL}firmware/fyzbit-usb.hex`,
  ble: `${import.meta.env.BASE_URL}firmware/fyzbit-ble-v2.hex`,
};

export type FlashProgress = { stage: ProgressStage; progress?: number };

export function isFlashSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/**
 * Flashes a FyzBit firmware variant onto a micro:bit over WebUSB — both are
 * flashed the same way (WebUSB flashing doesn't care whether the resulting
 * firmware also happens to speak Bluetooth); `variant` just picks which
 * .hex to fetch. Flashing the BLE variant onto a V1 board doesn't work (V1
 * lacks the flash/RAM for it) but the universal hex mechanism handles that
 * the same way it would any unsupported board — no special-casing needed here.
 *
 * Must be called directly from a user gesture (click handler) — connect()
 * triggers the browser's native USB device picker, which requires
 * transient user activation that an earlier `await` (e.g. a fetch) would
 * consume before the picker call.
 *
 * WebUSB and Web Serial can't hold the same device open at once, so the
 * connection is always released (disconnect()) before returning — even on
 * success — so a subsequent Web Serial connect() from the app can succeed.
 */
export async function flashFirmware(
  variant: FirmwareVariant,
  onProgress?: (p: FlashProgress) => void,
): Promise<void> {
  if (!isFlashSupported()) {
    throw new Error('WebUSB is not supported in this browser.');
  }

  const usb = createUSBConnection();
  try {
    await usb.connect({
      progress: (stage) => onProgress?.({ stage }),
    });

    const res = await fetch(FIRMWARE_HEX_URL[variant]);
    if (!res.ok) {
      throw new Error(`Failed to fetch firmware hex (HTTP ${res.status}).`);
    }
    const hexText = await res.text();

    await usb.flash(createUniversalHexFlashDataSource(hexText), {
      partial: true,
      progress: (stage, progress) => {
        const p: FlashProgress = { stage };
        if (progress !== undefined) p.progress = progress;
        onProgress?.(p);
      },
    });
  } finally {
    await usb.disconnect();
  }
}
