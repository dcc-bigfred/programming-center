/** Observed CV table: key = CV number, value = CV byte. */

export type CvTable = Record<number, number>;

export interface CvDiff {
  cv: number;
  value: number;
}

export interface CvScope {
  decoder: string;
  address: number;
  station: string;
}

interface Snapshot {
  scope: string;
  /** Working copy. Observed; diffs are table vs baseline. */
  table: CvTable;
  baseline: CvTable;
}

const STORAGE_KEY = "programming-center.cvRegistry";

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
    console.warn("cv table persist failed", err);
  }
}

/** Streamed reads write hundreds of values — group sessionStorage writes. */
function persist(): void {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(persistNow, 250);
}

/** Flush pending persist (ack, cancel, unload). */
export function flushCvTable(): void {
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

export function subscribeCvTable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCvSnapshot(): Snapshot {
  return snapshot;
}

export function ensureCvScope(scope: CvScope): void {
  const key = scopeKey(scope);
  if (snapshot.scope === key) return;
  flushCvTable();
  emit(load(key));
}

export function getCv(cv: number): number | undefined {
  if (Object.prototype.hasOwnProperty.call(snapshot.table, cv)) {
    return snapshot.table[cv];
  }
  if (Object.prototype.hasOwnProperty.call(snapshot.baseline, cv)) {
    return snapshot.baseline[cv];
  }
  return undefined;
}

/** User / wizard write. Observing this map updates the change list. */
export function setCv(cv: number, value: number): void {
  if (snapshot.table[cv] === value) return;
  emit({
    ...snapshot,
    table: { ...snapshot.table, [cv]: value },
  });
}

export function setCvs(entries: CvDiff[]): void {
  let changed = false;
  const table = { ...snapshot.table };
  for (const e of entries) {
    if (table[e.cv] !== e.value) {
      table[e.cv] = e.value;
      changed = true;
    }
  }
  if (!changed) return;
  emit({ ...snapshot, table });
}

export function setCvBits(cv: number, andMask: number, orMask: number): void {
  const current = getCv(cv) ?? 0;
  setCv(cv, (current & andMask) | orMask);
}

/** Loco read: fills the table and baseline, so it is not a pending change. */
export function rememberRead(entries: CvDiff[]): void {
  if (entries.length === 0) return;
  const table = { ...snapshot.table };
  const baseline = { ...snapshot.baseline };
  for (const e of entries) {
    table[e.cv] = e.value;
    baseline[e.cv] = e.value;
  }
  emit({ ...snapshot, table, baseline });
}

export function discardCvTable(): void {
  emit({ ...snapshot, table: { ...snapshot.baseline } });
}

/** Drop the in-memory table. Caller clears sessionStorage. */
export function resetCvTable(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  snapshot = empty();
  for (const listener of listeners) {
    listener();
  }
}

/** Keep the working table when Apply changes the programming-target address. */
export function retargetCvScopeAddress(address: number): void {
  const parts = snapshot.scope.split("|");
  if (parts.length !== 3) return;
  const next = `${parts[0]}|${address}|${parts[2]}`;
  if (next === snapshot.scope) return;
  emit({ ...snapshot, scope: next });
}

export function cvDiffs(snap: Snapshot = snapshot): CvDiff[] {
  const cvs = new Set([
    ...Object.keys(snap.table).map(Number),
    ...Object.keys(snap.baseline).map(Number),
  ]);
  return [...cvs]
    .sort((a, b) => a - b)
    .filter((cv) => snap.table[cv] !== snap.baseline[cv])
    .filter((cv) => Object.prototype.hasOwnProperty.call(snap.table, cv))
    .map((cv) => ({ cv, value: snap.table[cv] }));
}

export function formatCvDiffs(diffs: CvDiff[]): string {
  return diffs.map((d) => `CV${d.cv}=${d.value}`).join("\n");
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushCvTable());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCvTable();
  });
}
