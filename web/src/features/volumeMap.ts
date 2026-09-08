/** Maps a 0–100 slider onto the decoder’s master-volume CV. */

import { canonicalDecoderId } from "../decoders/registry";

export interface VolumeMap {
  cv: number;
  max: number;
}

const MAPS: Record<string, VolumeMap> = {
  "zimo-ms450": { cv: 266, max: 65 },
  "loksound-v4": { cv: 63, max: 64 },
  "loksound-v5": { cv: 63, max: 192 },
  rb23xx: { cv: 203, max: 64 },
};

export function volumeMapFor(decoderId: string): VolumeMap | undefined {
  return MAPS[canonicalDecoderId(decoderId)];
}

export function encodeVolume(percent: number, max: number): number {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  return Math.floor((p * max) / 100);
}

export function decodeVolume(value: number, max: number): number {
  if (max <= 0) return 0;
  const v = Math.min(max, Math.max(0, value));
  return Math.floor((v * 100) / max);
}
