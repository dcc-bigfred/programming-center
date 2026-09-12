/** ESU LokSound v4 / v5 digital coupler (manual §12.3.7 / §12.5.7). */

import {
  decodePhysical,
  emptyRow,
  isRowEmpty,
  pagesForRows,
  physicalScanPages,
  readRow,
  rowLayout,
  unreadPages,
  type CondState,
  type EsuMappingProfile,
  type EsuRow,
  type IndexPage,
  type IndexedGet,
  type OutputConfigLayout,
  type OutputMode,
} from "./esuMapping";

export const ESU_WALTZ_CVS = [246, 247, 248] as const;
export const ESU_TIME_UNIT_S = 0.016;
export const COUPLER_MODE_IDS = ["esuCoupler", "krois", "roco", "servoCoupler"] as const;

export type CouplerModeId = (typeof COUPLER_MODE_IDS)[number];

export function esuCouplerModes(profile: EsuMappingProfile): OutputMode[] {
  return profile.modes.filter((m) => COUPLER_MODE_IDS.includes(m.id as CouplerModeId));
}

export function isCouplerMode(value: number, modes: OutputMode[]): boolean {
  return modes.some((m) => m.value === value);
}

export function esuTimeSeconds(cv: number): number {
  return Math.max(0, cv) * ESU_TIME_UNIT_S;
}

export function removingShorterThanPush(removing: number, push: number): boolean {
  return removing < push;
}

export function servoCouplerHint(profile: EsuMappingProfile, layout: OutputConfigLayout): boolean {
  return (
    profile.id === "loksound-v4" &&
    layout.id.startsWith("aux") &&
    !layout.id.endsWith("c2") &&
    Number(layout.id.slice(3)) >= 7 &&
    Number(layout.id.slice(3)) <= 10
  );
}

/** Mode + brightness only — not the full mapping output-config dump. */
export function couplerOutputCvs(profile: EsuMappingProfile): number[] {
  const cvs = new Set<number>();
  for (const out of profile.outputConfigs) {
    cvs.add(out.modeCv);
    cvs.add(out.brightnessCv);
  }
  return [...cvs].sort((a, b) => a - b);
}

export function keysOn(row: EsuRow): number[] {
  return row.conditions.keys.flatMap((state, i) => (state === "on" ? [i] : []));
}

export function rowPhysicalIds(
  profile: EsuMappingProfile,
  row: number,
  get: IndexedGet,
): string[] | undefined {
  const layout = rowLayout(profile, row);
  const physCvs = layout.outputCvs.slice(0, profile.physicalCvCount);
  const values: number[] = [];
  for (const cv of physCvs) {
    const v = get(layout.outputPage, cv);
    if (v === undefined) return undefined;
    values.push(v);
  }
  return decodePhysical(profile, values);
}

export function rowsContainingPhysical(
  profile: EsuMappingProfile,
  outputId: string,
  get: IndexedGet,
): number[] | undefined {
  const rows: number[] = [];
  for (let row = 1; row <= profile.rowCount; row++) {
    const ids = rowPhysicalIds(profile, row, get);
    if (ids === undefined) return undefined;
    if (ids.includes(outputId)) rows.push(row);
  }
  return rows;
}

export type CouplerFState =
  | { kind: "unread" }
  | { kind: "none" }
  | { kind: "simple"; row: number; keys: number[] }
  | { kind: "complex"; keys: number[] };

export function couplerFState(
  profile: EsuMappingProfile,
  outputId: string,
  get: IndexedGet,
): CouplerFState {
  const matching = rowsContainingPhysical(profile, outputId, get);
  if (matching === undefined) return { kind: "unread" };
  if (matching.length === 0) return { kind: "none" };
  const decoded: { row: number; data: EsuRow }[] = [];
  for (const row of matching) {
    const data = readRow(profile, row, get);
    if (!data) return { kind: "unread" };
    decoded.push({ row, data });
  }
  const keys = [...new Set(decoded.flatMap(({ data }) => keysOn(data)))].sort((a, b) => a - b);
  const dedicated = decoded.filter(
    ({ data }) => data.physical.length === 1 && data.physical[0] === outputId,
  );
  if (dedicated.length === 1 && matching.length === 1) {
    return { kind: "simple", row: dedicated[0].row, keys: keysOn(decoded[0].data) };
  }
  return { kind: "complex", keys };
}

export type EmptyRowCandidate =
  | { kind: "found"; row: number }
  | { kind: "need"; row: number }
  | { kind: "no-empty" };

export function emptyRowCandidate(profile: EsuMappingProfile, get: IndexedGet): EmptyRowCandidate {
  for (let row = profile.rowCount; row >= 1; row--) {
    const ids = rowPhysicalIds(profile, row, get);
    if (ids === undefined) return { kind: "need", row };
    if (ids.length > 0) continue;
    const data = readRow(profile, row, get);
    if (!data) return { kind: "need", row };
    if (isRowEmpty(data)) return { kind: "found", row };
  }
  return { kind: "no-empty" };
}

export function withFKeyOn(row: EsuRow, fKey: number): EsuRow {
  const keys: CondState[] = row.conditions.keys.map(() => "ignore");
  if (fKey >= 0 && fKey < keys.length) keys[fKey] = "on";
  return { ...row, conditions: { ...row.conditions, keys } };
}

export type CouplerFAssign =
  | { kind: "apply"; row: number; next: EsuRow; overwriteKeys: number[] }
  | { kind: "complex" }
  | { kind: "unread" }
  | { kind: "no-empty" };

export function planCouplerFAssign(
  profile: EsuMappingProfile,
  outputId: string,
  fKey: number,
  get: IndexedGet,
): CouplerFAssign {
  const state = couplerFState(profile, outputId, get);
  if (state.kind === "unread") return { kind: "unread" };
  if (state.kind === "complex") return { kind: "complex" };
  if (state.kind === "simple") {
    const current = readRow(profile, state.row, get);
    if (!current) return { kind: "unread" };
    return {
      kind: "apply",
      row: state.row,
      next: withFKeyOn(current, fKey),
      overwriteKeys: keysOn(current).filter((k) => k !== fKey),
    };
  }
  const empty = emptyRowCandidate(profile, get);
  if (empty.kind === "need") return { kind: "unread" };
  if (empty.kind === "no-empty") return { kind: "no-empty" };
  return {
    kind: "apply",
    row: empty.row,
    next: withFKeyOn({ ...emptyRow(profile), physical: [outputId] }, fKey),
    overwriteKeys: [],
  };
}

export function pagesToShowCouplerF(
  profile: EsuMappingProfile,
  outputIds: string[],
  get: IndexedGet,
): IndexPage[] {
  const phys = physicalScanPages(profile);
  if (unreadPages(phys, get).length > 0) return phys;
  const rows = new Set<number>();
  for (const id of outputIds) {
    const found = rowsContainingPhysical(profile, id, get);
    if (found === undefined) return phys;
    for (const row of found) rows.add(row);
  }
  return pagesForRows(profile, [...rows]);
}

export function pagesToAssignCouplerF(
  profile: EsuMappingProfile,
  outputId: string,
  get: IndexedGet,
): IndexPage[] {
  const show = unreadPages(pagesToShowCouplerF(profile, [outputId], get), get);
  if (show.length > 0) return show;
  const state = couplerFState(profile, outputId, get);
  if (state.kind !== "none") return [];
  const empty = emptyRowCandidate(profile, get);
  if (empty.kind === "need") return unreadPages(pagesForRows(profile, [empty.row]), get);
  return [];
}
