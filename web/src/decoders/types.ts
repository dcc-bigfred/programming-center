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

export type FeatureId = "cv" | "speed" | "address" | "volume" | "backup";

export interface DecoderProfile {
  id: string;
  features: FeatureId[];
  cvs: CvItem[];
  /** CV 29 bit that selects long address. NMRA default is 5; RailBOX uses 3. */
  longAddressBit?: number;
}

export function decoderLabelKey(id: string): string {
  return `decoder.${id}`;
}
