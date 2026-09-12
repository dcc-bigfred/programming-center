export type CvKind = "number" | "enum" | "bits";

export interface CvBit {
  bit: number;
  offKey: string;
  onKey: string;
}

export interface CvOption {
  value: number;
  labelKey: string;
}

export interface CvItem {
  cv: number;
  descriptionKey?: string;
  descriptionParams?: Record<string, string | number>;
  hintKey?: string;
  /** i18n key for a collapsible group; same key gathers CVs into one section. */
  groupKey?: string;
  kind?: CvKind;
  min?: number;
  max?: number;
  default?: number;
  readOnly?: boolean;
  /** If set, the value must be one of these (in addition to min/max). */
  allowedValues?: number[];
  options?: CvOption[];
  bits?: CvBit[];
}

export function grouped(groupKey: string, items: CvItem[]): CvItem[] {
  return items.map((item) => ({ ...item, groupKey }));
}

export type FeatureId =
  | "cv"
  | "speed"
  | "address"
  | "volume"
  | "mapping"
  | "coupler"
  | "backup"
  | "firmware";

/** CV numbers or inclusive [from, to] ranges in one write-priority tier. */
export type CvWriteTier = (number | [number, number])[];

export interface DecoderProfile {
  id: string;
  features: FeatureId[];
  cvs: CvItem[];
  /** CV 29 bit that selects long address. NMRA default is 5; RailBOX uses 3. */
  longAddressBit?: number;
  /**
   * Write order: tier 0 first, then 1, … Unlisted CVs get Infinity (last)
   * and then sort by CV number.
   */
  writePriority?: CvWriteTier[];
}

export function cvWritePriorityOf(cv: number, tiers: CvWriteTier[] | undefined): number {
  if (!tiers) return Infinity;
  for (let i = 0; i < tiers.length; i++) {
    for (const entry of tiers[i]) {
      if (Array.isArray(entry)) {
        if (cv >= entry[0] && cv <= entry[1]) return i;
      } else if (entry === cv) {
        return i;
      }
    }
  }
  return Infinity;
}

export function sortCvDiffsForWrite<T extends { cv: number }>(
  diffs: T[],
  profile: DecoderProfile | undefined,
): T[] {
  const tiers = profile?.writePriority;
  return [...diffs].sort((a, b) => {
    const pa = cvWritePriorityOf(a.cv, tiers);
    const pb = cvWritePriorityOf(b.cv, tiers);
    return pa - pb || a.cv - b.cv;
  });
}

export function decoderLabelKey(id: string): string {
  return `decoder.${id}`;
}
