import type { CvScope } from "./table";

/** One observed table (main or side): working copy vs baseline, scoped by loco. */
export interface CvStore<K extends string | number> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { scope: string };
  ensureScope(scope: CvScope): void;
  get(key: K): number | undefined;
  set(key: K, value: number): void;
  setMany(entries: { key: K; value: number }[]): void;
  diffs(): { key: K; value: number }[];
  rememberRead(entries: { key: K; value: number }[]): void;
  discard(): void;
  reset(): void;
  flush(): void;
}

/** One `cv.write` batch plus which side keys to promote if those CVs succeed. */
export interface SideWriteBatch<K extends string | number> {
  cvs: { cv: number; value: number }[];
  remember: { key: K; value: number; cv: number }[];
  /** Index registers (e.g. CV 31/32) — baseline on the main table, not a pending mapping diff. */
  rememberMain?: { cv: number; value: number }[];
}

/**
 * Page-scoped extra CV table. Registered while its owning screen is mounted.
 * CvRegistry never hard-codes CV 31/32 — the owner supplies applyBatches.
 */
export interface SideTable<K extends string | number = string> {
  id: string;
  labelI18nKey: string;
  store: CvStore<K>;
  applyBatches(diffs: { key: K; value: number }[]): SideWriteBatch<K>[];
  formatEntry(key: K, value: number): string;
}

export interface ChangeSectionEntry {
  key: string;
  label: string;
  value: number;
}

export interface ChangeSection {
  source: "main" | string;
  labelI18nKey: string;
  entries: ChangeSectionEntry[];
}
