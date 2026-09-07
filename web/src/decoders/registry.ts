import type { DecoderProfile } from "./types";
import { loksoundV4 } from "./loksound-v4";
import { loksoundV5 } from "./loksound-v5";
import { nmra } from "./nmra";
import { rb23xx } from "./rb23xx";
import { zimoMs450 } from "./zimo-ms450";

const DECODERS: DecoderProfile[] = [zimoMs450, loksoundV4, loksoundV5, rb23xx, nmra];

/** Older query ids that now resolve to a single catalogue entry. */
const ALIASES: Record<string, string> = {
  rb2300: "rb23xx",
  rb2302: "rb23xx",
};

export function canonicalDecoderId(id: string): string {
  return ALIASES[id] ?? id;
}

export function listDecoders(): DecoderProfile[] {
  return DECODERS;
}

export function getDecoder(id: string | null | undefined): DecoderProfile | undefined {
  if (!id) return undefined;
  const canonical = canonicalDecoderId(id);
  return DECODERS.find((d) => d.id === canonical);
}
