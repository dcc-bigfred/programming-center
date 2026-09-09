/** Indexed CV table: key = "cv31.cv32.cv", value = CV byte. */

import type { CvScope } from "./table";

export interface IndexedCvDiff {
  key: string;
  cv31: number;
  cv32: number;
  cv: number;
  value: number;
}

type IndexedTable = Record<string, number>;

interface Snapshot {
  scope: string;
  table: IndexedTable;
  baseline: IndexedTable;
}

const STORAGE_KEY = "programming-center.indexedCvRegistry";

function scopeKey(scope: CvScope): string {
  return `${scope.decoder}|${scope.address}|${scope.station}`;
}

function empty(scope = ""): Snapshot {
  return { scope, table: {}, baseline: {} };
}

function load(scope: string): Snapshot {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty(scope);
    const parsed = JSON.parse(raw) as Snapshot;
    if (parsed.scope !== scope || !parsed.table || !parsed.baseline) {
      return empty(scope);
    }
    return parsed;
  } catch {
    return empty(scope);
  }
}

let snapshot: Snapshot = empty();
const listeners = new Set<() => void>();
let persistTimer: number | null = null;

function persistNow(): void {
  persistTimer = null;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("indexed cv table persist failed", err);
  }
}

function persist(): void {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(persistNow, 250);
}

export function flushIndexedCvTable(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistNow();
  }
}

function emit(next: Snapshot): void {
  snapshot = next;
  persist();
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeIndexedCvTable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIndexedCvSnapshot(): Snapshot {
  return snapshot;
}

export function ensureIndexedCvScope(scope: CvScope): void {
  const key = scopeKey(scope);
  if (snapshot.scope === key) return;
  flushIndexedCvTable();
  emit(load(key));
}

export function getIndexedCv(key: string): number | undefined {
  if (Object.prototype.hasOwnProperty.call(snapshot.table, key)) {
    return snapshot.table[key];
  }
  if (Object.prototype.hasOwnProperty.call(snapshot.baseline, key)) {
    return snapshot.baseline[key];
  }
  return undefined;
}

export function setIndexedCv(key: string, value: number): void {
  if (snapshot.table[key] === value) return;
  emit({
    ...snapshot,
    table: { ...snapshot.table, [key]: value },
  });
}

export function setIndexedCvs(entries: { key: string; value: number }[]): void {
  let changed = false;
  const table = { ...snapshot.table };
  for (const e of entries) {
    if (table[e.key] !== e.value) {
      table[e.key] = e.value;
      changed = true;
    }
  }
  if (!changed) return;
  emit({ ...snapshot, table });
}

export function rememberIndexedRead(entries: { key: string; value: number }[]): void {
  if (entries.length === 0) return;
  const table = { ...snapshot.table };
  const baseline = { ...snapshot.baseline };
  for (const e of entries) {
    table[e.key] = e.value;
    baseline[e.key] = e.value;
  }
  emit({ ...snapshot, table, baseline });
}

export function discardIndexedCvTable(): void {
  emit({ ...snapshot, table: { ...snapshot.baseline } });
}

export function resetIndexedCvTable(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  snapshot = empty();
  for (const listener of listeners) {
    listener();
  }
}

export function indexedCvDiffs(snap: Snapshot = snapshot): IndexedCvDiff[] {
  const keys = new Set([...Object.keys(snap.table), ...Object.keys(snap.baseline)]);
  const diffs: IndexedCvDiff[] = [];
  for (const key of keys) {
    if (snap.table[key] === snap.baseline[key]) continue;
    if (!Object.prototype.hasOwnProperty.call(snap.table, key)) continue;
    const parts = key.split(".");
    diffs.push({
      key,
      cv31: Number(parts[0]),
      cv32: Number(parts[1]),
      cv: Number(parts[2]),
      value: snap.table[key],
    });
  }
  return diffs.sort((a, b) => a.cv32 - b.cv32 || a.cv - b.cv);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushIndexedCvTable());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushIndexedCvTable();
  });
}
