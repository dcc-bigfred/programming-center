/** ESU LokSound v4 / v5 function mapping (indexed CV 31/32 → 257–511). */

import { indexedCvStore } from "../cv/indexedTable";
import type { SideTable, SideWriteBatch } from "../cv/store";

export const LOKSOUND_V4_MAPPING_ID = "loksound-v4";
export const LOKSOUND_V5_MAPPING_ID = "loksound-v5";

export const INDEX_CV31 = 31;
export const INDEX_CV32 = 32;
export const INDEX_CV31_VALUE = 16;
export const INDEXED_CV_START = 257;
export const ROW_STRIDE = 16;
export const ROWS_PER_PAGE = 16;
export const SCENE_GROUP_SIZE = 5;

export type CondState = "ignore" | "on" | "off";

export interface EsuConditions {
  moving: CondState;
  direction: CondState;
  /** Index is the F-key number. Length is `maxKey + 1`. */
  keys: CondState[];
  wheelSensor: CondState;
  sensors: [CondState, CondState, CondState, CondState];
}

export interface PhysicalDef {
  id: string;
  cvOffset: number;
  bit: number;
}

export interface LogicFn {
  id: string;
  cvOffset: number;
  bit: number;
}

export interface OutputConfigLayout {
  id: string;
  modeCv: number;
  delayCv: number;
  autoOffCv: number;
  brightnessCv: number;
  spec1Cv: number;
  spec2Cv: number;
  spec3Cv?: number;
}

export interface OutputMode {
  value: number;
  id: string;
}

export interface RowLayout {
  row: number;
  conditionPage: number;
  outputPage: number;
  cvStart: number;
  conditionCvs: number[];
  outputCvs: number[];
}

export interface RowGroup {
  firstRow: number;
  lastRow: number;
  pages: { cv32: number; cvs: number[] }[];
}

export interface IndexedEntry {
  cv32: number;
  cv: number;
  value: number;
}

export interface EsuRow {
  conditions: EsuConditions;
  physical: string[];
  logic: string[];
  slots: number[];
}

export interface EsuMappingProfile {
  id: typeof LOKSOUND_V4_MAPPING_ID | typeof LOKSOUND_V5_MAPPING_ID;
  rowCount: number;
  maxKey: number;
  conditionCvCount: number;
  physicalCvCount: number;
  logicCvCount: number;
  soundCvCount: number;
  slotCount: number;
  physical: PhysicalDef[];
  logicFns: LogicFn[];
  outputConfigs: OutputConfigLayout[];
  modes: OutputMode[];
}

export const SPEC1_BITS = [
  { id: "phase", bit: 0 },
  { id: "gradeCrossing", bit: 1 },
  { id: "rule17Fwd", bit: 2 },
  { id: "rule17Rev", bit: 3 },
  { id: "dimmer", bit: 4 },
  { id: "led", bit: 7 },
] as const;

const SHARED_MODES: OutputMode[] = [
  { value: 1, id: "dimmable" },
  { value: 2, id: "fade" },
  { value: 3, id: "firebox" },
  { value: 4, id: "intelligentFirebox" },
  { value: 5, id: "strobe" },
  { value: 6, id: "doubleStrobe" },
  { value: 7, id: "rotaryBeacon" },
  { value: 8, id: "strato" },
  { value: 9, id: "ditch1" },
  { value: 10, id: "ditch2" },
  { value: 11, id: "oscillator" },
  { value: 12, id: "flash" },
  { value: 13, id: "mars" },
  { value: 14, id: "gyra" },
  { value: 15, id: "fred" },
  { value: 16, id: "fluorescent" },
  { value: 17, id: "energySaver" },
];

function phys(id: string, cvOffset: number, bit: number): PhysicalDef {
  return { id, cvOffset, bit };
}

function logic(id: string, cvOffset: number, bit: number): LogicFn {
  return { id, cvOffset, bit };
}

function outputConfig(
  id: string,
  modeCv: number,
  spec2Cv?: number,
  spec3?: boolean,
): OutputConfigLayout {
  return {
    id,
    modeCv,
    delayCv: modeCv + 1,
    autoOffCv: modeCv + 2,
    brightnessCv: modeCv + 3,
    spec1Cv: modeCv + 4,
    spec2Cv: spec2Cv ?? modeCv + 5,
    spec3Cv: spec3 ? modeCv - 1 : undefined,
  };
}

function v4Outputs(): OutputConfigLayout[] {
  return [
    outputConfig("headlight", 259),
    outputConfig("rearlight", 267, 273),
    outputConfig("aux1", 275),
    outputConfig("aux2", 283),
    outputConfig("aux3", 291),
    outputConfig("aux4", 299),
    outputConfig("aux5", 307),
    outputConfig("aux6", 315),
    outputConfig("aux7", 323),
    outputConfig("aux8", 331),
    outputConfig("aux9", 339),
    outputConfig("aux10", 347),
    outputConfig("headlight2", 355),
    outputConfig("rearlight2", 363),
    outputConfig("aux1c2", 371),
    outputConfig("aux2c2", 379),
  ];
}

function v5Outputs(): OutputConfigLayout[] {
  const aux = Array.from({ length: 18 }, (_, i) =>
    outputConfig(`aux${i + 1}`, 275 + i * 8, undefined, true),
  );
  return [
    outputConfig("headlight", 259, undefined, true),
    outputConfig("rearlight", 267, 273, true),
    ...aux,
    outputConfig("headlight2", 419, undefined, true),
    outputConfig("rearlight2", 427, undefined, true),
    outputConfig("aux1c2", 435, undefined, true),
    outputConfig("aux2c2", 443, undefined, true),
  ];
}

export const loksoundV4Mapping: EsuMappingProfile = {
  id: LOKSOUND_V4_MAPPING_ID,
  rowCount: 40,
  maxKey: 28,
  conditionCvCount: 9,
  physicalCvCount: 2,
  logicCvCount: 2,
  soundCvCount: 3,
  slotCount: 24,
  physical: [
    phys("headlight", 0, 0),
    phys("rearlight", 0, 1),
    phys("aux1", 0, 2),
    phys("aux2", 0, 3),
    phys("aux3", 0, 4),
    phys("aux4", 0, 5),
    phys("aux5", 0, 6),
    phys("aux6", 0, 7),
    phys("aux7", 1, 0),
    phys("aux8", 1, 1),
    phys("aux9", 1, 2),
    phys("aux10", 1, 3),
    phys("headlight2", 1, 4),
    phys("rearlight2", 1, 5),
    phys("aux1c2", 1, 6),
    phys("aux2c2", 1, 7),
  ],
  logicFns: [
    logic("abvOff", 0, 0),
    logic("shunting", 0, 1),
    logic("dynamicBrakes", 0, 2),
    logic("firebox", 0, 3),
    logic("dimmer", 0, 4),
    logic("gradeCrossing", 0, 5),
    logic("clockedSmoke", 1, 0),
    logic("notchUp", 1, 1),
    logic("notchDown", 1, 2),
    logic("soundFader", 1, 3),
    logic("disableBrakeSound", 1, 4),
    logic("doppler", 1, 5),
    logic("volumeControl", 1, 6),
    logic("shift", 1, 7),
  ],
  outputConfigs: v4Outputs(),
  modes: [
    ...SHARED_MODES,
    { value: 23, id: "fan" },
    { value: 24, id: "seuthe" },
    { value: 25, id: "exhaustTrigger" },
    { value: 27, id: "servo" },
    { value: 28, id: "krois" },
    { value: 29, id: "roco" },
    { value: 30, id: "panto" },
    { value: 31, id: "servoCoupler" },
  ],
};

export const loksoundV5Mapping: EsuMappingProfile = {
  id: LOKSOUND_V5_MAPPING_ID,
  rowCount: 72,
  maxKey: 31,
  conditionCvCount: 10,
  physicalCvCount: 3,
  logicCvCount: 3,
  soundCvCount: 4,
  slotCount: 32,
  physical: [
    phys("headlight", 0, 0),
    phys("rearlight", 0, 1),
    phys("aux1", 0, 2),
    phys("aux2", 0, 3),
    phys("aux3", 0, 4),
    phys("aux4", 0, 5),
    phys("aux5", 0, 6),
    phys("aux6", 0, 7),
    phys("aux7", 1, 0),
    phys("aux8", 1, 1),
    phys("aux9", 1, 2),
    phys("aux10", 1, 3),
    phys("aux11", 1, 4),
    phys("aux12", 1, 5),
    phys("aux13", 1, 6),
    phys("aux14", 1, 7),
    phys("aux15", 2, 0),
    phys("aux16", 2, 1),
    phys("aux17", 2, 2),
    phys("aux18", 2, 3),
    phys("headlight2", 2, 4),
    phys("rearlight2", 2, 5),
    phys("aux1c2", 2, 6),
    phys("aux2c2", 2, 7),
  ],
  logicFns: [
    logic("optionalLoad", 0, 0),
    logic("shunting", 0, 1),
    logic("brake1", 0, 2),
    logic("brake2", 0, 3),
    logic("brake3", 0, 4),
    logic("primaryLoad", 0, 5),
    logic("uncoupling", 0, 6),
    logic("driveHold", 0, 7),
    logic("firebox", 1, 0),
    logic("dimmer", 1, 1),
    logic("gradeCrossing", 1, 2),
    logic("disableAccel", 1, 3),
    logic("smoke", 1, 4),
    logic("soundFader", 1, 5),
    logic("disableBrakeSound", 1, 6),
    logic("volumeControl", 1, 7),
    logic("shift1", 2, 0),
    logic("shift2", 2, 1),
    logic("shift3", 2, 2),
    logic("shift4", 2, 3),
    logic("shift5", 2, 4),
    logic("shift6", 2, 5),
  ],
  outputConfigs: v5Outputs(),
  modes: [
    ...SHARED_MODES,
    { value: 18, id: "randomStrobe" },
    { value: 21, id: "esuCoupler" },
    { value: 22, id: "smokeSound" },
    { value: 23, id: "fan" },
    { value: 24, id: "seuthe" },
    { value: 25, id: "steamTrigger" },
    { value: 26, id: "smokeExternal" },
    { value: 27, id: "servo" },
    { value: 28, id: "krois" },
    { value: 29, id: "roco" },
    { value: 30, id: "panto" },
    { value: 31, id: "powerPack" },
  ],
};

export function esuMappingProfile(decoderId: string): EsuMappingProfile | undefined {
  if (decoderId === LOKSOUND_V4_MAPPING_ID) return loksoundV4Mapping;
  if (decoderId === LOKSOUND_V5_MAPPING_ID) return loksoundV5Mapping;
  return undefined;
}

/** Mapping and coupler share ESU_SIDE_TABLE; leave-confirm only when leaving both. */
export function keepsEsuSideTable(pathname: string): boolean {
  return pathname === "/mapping" || pathname === "/coupler";
}

export function indexedKey(cv32: number, cv: number): string {
  return `${INDEX_CV31_VALUE}.${cv32}.${cv}`;
}

export function formatIndexedEntry(key: string, _value: number): string {
  const parsed = parseIndexedKey(key);
  if (!parsed) return key;
  return `CV${parsed.cv} (str. ${parsed.cv32})`;
}

export const ESU_SIDE_ID = "esu-indexed";
export const ESU_SIDE_LABEL_KEY = "changes.esuGroup";

/** Side-table write plan: CV31/32 first, then payload; remember only payload keys. */
export function esuSideBatches(diffs: { key: string; value: number }[]): SideWriteBatch<string>[] {
  const entries: IndexedEntry[] = [];
  for (const d of diffs) {
    const parsed = parseIndexedKey(d.key);
    if (!parsed) continue;
    entries.push({ cv32: parsed.cv32, cv: parsed.cv, value: d.value });
  }
  return applyBatches(entries).map((batch) => ({
    cvs: batch.cvs,
    remember: batch.cvs
      .filter((e) => e.cv >= INDEXED_CV_START)
      .map((e) => ({ key: indexedKey(batch.cv32, e.cv), value: e.value, cv: e.cv })),
    rememberMain: [
      { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
      { cv: INDEX_CV32, value: batch.cv32 },
    ],
  }));
}

export const ESU_SIDE_TABLE: SideTable<string> = {
  id: ESU_SIDE_ID,
  labelI18nKey: ESU_SIDE_LABEL_KEY,
  store: indexedCvStore,
  applyBatches: esuSideBatches,
  formatEntry: formatIndexedEntry,
};

export function parseIndexedKey(key: string): { cv31: number; cv32: number; cv: number } | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  const cv31 = Number(parts[0]);
  const cv32 = Number(parts[1]);
  const cv = Number(parts[2]);
  if (![cv31, cv32, cv].every((n) => Number.isInteger(n))) return null;
  return { cv31, cv32, cv };
}

export function rowCvStart(row: number): number {
  return INDEXED_CV_START + ((row - 1) % ROWS_PER_PAGE) * ROW_STRIDE;
}

export function rowLayout(profile: EsuMappingProfile, row: number): RowLayout {
  const pageIndex = Math.floor((row - 1) / ROWS_PER_PAGE);
  const cvStart = rowCvStart(row);
  const split = profile.id === LOKSOUND_V5_MAPPING_ID;
  const conditionPage = split ? 3 + pageIndex : 2 + pageIndex;
  const outputPage = split ? 8 + pageIndex : conditionPage;
  const conditionCvs = Array.from({ length: profile.conditionCvCount }, (_, i) => cvStart + i);
  const outputStart = split ? cvStart : cvStart + profile.conditionCvCount;
  const outputCount = profile.physicalCvCount + profile.logicCvCount + profile.soundCvCount;
  const outputCvs = Array.from({ length: outputCount }, (_, i) => outputStart + i);
  return { row, conditionPage, outputPage, cvStart, conditionCvs, outputCvs };
}

export function rowGroups(profile: EsuMappingProfile): RowGroup[] {
  const groups: RowGroup[] = [];
  for (let first = 1; first <= profile.rowCount; first += SCENE_GROUP_SIZE) {
    const last = Math.min(first + SCENE_GROUP_SIZE - 1, profile.rowCount);
    const byPage = new Map<number, Set<number>>();
    for (let row = first; row <= last; row++) {
      const layout = rowLayout(profile, row);
      const cond = byPage.get(layout.conditionPage) ?? new Set<number>();
      for (const cv of layout.conditionCvs) cond.add(cv);
      byPage.set(layout.conditionPage, cond);
      const out = byPage.get(layout.outputPage) ?? new Set<number>();
      for (const cv of layout.outputCvs) out.add(cv);
      byPage.set(layout.outputPage, out);
    }
    groups.push({
      firstRow: first,
      lastRow: last,
      pages: [...byPage.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([cv32, cvs]) => ({ cv32, cvs: [...cvs].sort((a, b) => a - b) })),
    });
  }
  return groups;
}

export function outputConfigPage(profile: EsuMappingProfile): { cv32: number; cvs: number[] } {
  const cvs = new Set<number>();
  for (const out of profile.outputConfigs) {
    cvs.add(out.modeCv);
    cvs.add(out.delayCv);
    cvs.add(out.autoOffCv);
    cvs.add(out.brightnessCv);
    cvs.add(out.spec1Cv);
    cvs.add(out.spec2Cv);
    if (out.spec3Cv !== undefined) cvs.add(out.spec3Cv);
  }
  return { cv32: 0, cvs: [...cvs].sort((a, b) => a - b) };
}

export function emptyConditions(maxKey: number): EsuConditions {
  return {
    moving: "ignore",
    direction: "ignore",
    keys: Array.from({ length: maxKey + 1 }, () => "ignore"),
    wheelSensor: "ignore",
    sensors: ["ignore", "ignore", "ignore", "ignore"],
  };
}

export function emptyRow(profile: EsuMappingProfile): EsuRow {
  return {
    conditions: emptyConditions(profile.maxKey),
    physical: [],
    logic: [],
    slots: [],
  };
}

export function packPair(state: CondState, pairIndex: number): number {
  if (state === "ignore") return 0;
  const shift = pairIndex * 2;
  return (state === "on" ? 1 : 2) << shift;
}

export function unpackPair(value: number, pairIndex: number): CondState {
  const bits = (value >> (pairIndex * 2)) & 3;
  if (bits === 1) return "on";
  if (bits === 2) return "off";
  return "ignore";
}

function setKey(keys: CondState[], n: number, state: CondState): void {
  if (n >= 0 && n < keys.length) keys[n] = state;
}

function packKeys(keys: CondState[], from: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    value |= packPair(keys[from + i] ?? "ignore", i);
  }
  return value;
}

export function decodeConditions(profile: EsuMappingProfile, cvs: number[]): EsuConditions {
  const cond = emptyConditions(profile.maxKey);
  const a = cvs[0] ?? 0;
  cond.moving = unpackPair(a, 0);
  cond.direction = unpackPair(a, 1);
  setKey(cond.keys, 0, unpackPair(a, 2));
  setKey(cond.keys, 1, unpackPair(a, 3));
  for (let i = 0; i < 6; i++) {
    const cv = cvs[1 + i] ?? 0;
    for (let p = 0; p < 4; p++) {
      setKey(cond.keys, 2 + i * 4 + p, unpackPair(cv, p));
    }
  }
  const h = cvs[7] ?? 0;
  setKey(cond.keys, 26, unpackPair(h, 0));
  setKey(cond.keys, 27, unpackPair(h, 1));
  setKey(cond.keys, 28, unpackPair(h, 2));
  if (profile.id === LOKSOUND_V5_MAPPING_ID) {
    setKey(cond.keys, 29, unpackPair(h, 3));
    const iCv = cvs[8] ?? 0;
    setKey(cond.keys, 30, unpackPair(iCv, 0));
    setKey(cond.keys, 31, unpackPair(iCv, 1));
    cond.wheelSensor = unpackPair(iCv, 2);
    const j = cvs[9] ?? 0;
    cond.sensors = [unpackPair(j, 0), unpackPair(j, 1), unpackPair(j, 2), unpackPair(j, 3)];
  } else {
    cond.wheelSensor = unpackPair(h, 3);
    const iCv = cvs[8] ?? 0;
    cond.sensors = [unpackPair(iCv, 0), unpackPair(iCv, 1), unpackPair(iCv, 2), unpackPair(iCv, 3)];
  }
  return cond;
}

export function encodeConditions(profile: EsuMappingProfile, cond: EsuConditions): number[] {
  const keys = cond.keys;
  const out = Array.from({ length: profile.conditionCvCount }, () => 0);
  out[0] =
    packPair(cond.moving, 0) | packPair(cond.direction, 1) | packPair(keys[0] ?? "ignore", 2) | packPair(keys[1] ?? "ignore", 3);
  for (let i = 0; i < 6; i++) {
    out[1 + i] = packKeys(keys, 2 + i * 4, 4);
  }
  if (profile.id === LOKSOUND_V5_MAPPING_ID) {
    out[7] =
      packPair(keys[26] ?? "ignore", 0) |
      packPair(keys[27] ?? "ignore", 1) |
      packPair(keys[28] ?? "ignore", 2) |
      packPair(keys[29] ?? "ignore", 3);
    out[8] =
      packPair(keys[30] ?? "ignore", 0) |
      packPair(keys[31] ?? "ignore", 1) |
      packPair(cond.wheelSensor, 2);
    out[9] =
      packPair(cond.sensors[0], 0) |
      packPair(cond.sensors[1], 1) |
      packPair(cond.sensors[2], 2) |
      packPair(cond.sensors[3], 3);
  } else {
    out[7] =
      packPair(keys[26] ?? "ignore", 0) |
      packPair(keys[27] ?? "ignore", 1) |
      packPair(keys[28] ?? "ignore", 2) |
      packPair(cond.wheelSensor, 3);
    out[8] =
      packPair(cond.sensors[0], 0) |
      packPair(cond.sensors[1], 1) |
      packPair(cond.sensors[2], 2) |
      packPair(cond.sensors[3], 3);
  }
  return out;
}

export function decodePhysical(profile: EsuMappingProfile, cvs: number[]): string[] {
  const ids: string[] = [];
  for (const p of profile.physical) {
    if (((cvs[p.cvOffset] ?? 0) >> p.bit) & 1) ids.push(p.id);
  }
  return ids;
}

export function encodePhysical(profile: EsuMappingProfile, ids: string[]): number[] {
  const out = Array.from({ length: profile.physicalCvCount }, () => 0);
  const set = new Set(ids);
  for (const p of profile.physical) {
    if (set.has(p.id)) out[p.cvOffset] |= 1 << p.bit;
  }
  return out;
}

export function decodeLogic(profile: EsuMappingProfile, cvs: number[]): string[] {
  const ids: string[] = [];
  for (const fn of profile.logicFns) {
    if (((cvs[fn.cvOffset] ?? 0) >> fn.bit) & 1) ids.push(fn.id);
  }
  return ids;
}

export function encodeLogic(profile: EsuMappingProfile, ids: string[]): number[] {
  const out = Array.from({ length: profile.logicCvCount }, () => 0);
  const set = new Set(ids);
  for (const fn of profile.logicFns) {
    if (set.has(fn.id)) out[fn.cvOffset] |= 1 << fn.bit;
  }
  return out;
}

export function decodeSlots(slotCount: number, cvs: number[]): number[] {
  const slots: number[] = [];
  for (let n = 1; n <= slotCount; n++) {
    const cvIndex = Math.floor((n - 1) / 8);
    const bit = (n - 1) % 8;
    if (((cvs[cvIndex] ?? 0) >> bit) & 1) slots.push(n);
  }
  return slots;
}

export function encodeSlots(slotCount: number, slots: number[]): number[] {
  const cvCount = Math.ceil(slotCount / 8);
  const out = Array.from({ length: cvCount }, () => 0);
  for (const n of slots) {
    if (n < 1 || n > slotCount) continue;
    const cvIndex = Math.floor((n - 1) / 8);
    const bit = (n - 1) % 8;
    out[cvIndex] |= 1 << bit;
  }
  return out;
}

export function decodeRow(profile: EsuMappingProfile, conditionCvs: number[], outputCvs: number[]): EsuRow {
  const physical = outputCvs.slice(0, profile.physicalCvCount);
  const logic = outputCvs.slice(profile.physicalCvCount, profile.physicalCvCount + profile.logicCvCount);
  const sound = outputCvs.slice(profile.physicalCvCount + profile.logicCvCount);
  return {
    conditions: decodeConditions(profile, conditionCvs),
    physical: decodePhysical(profile, physical),
    logic: decodeLogic(profile, logic),
    slots: decodeSlots(profile.slotCount, sound),
  };
}

export function encodeRow(profile: EsuMappingProfile, row: EsuRow): { conditions: number[]; outputs: number[] } {
  return {
    conditions: encodeConditions(profile, row.conditions),
    outputs: [
      ...encodePhysical(profile, row.physical),
      ...encodeLogic(profile, row.logic),
      ...encodeSlots(profile.slotCount, row.slots),
    ],
  };
}

export function rowEntries(profile: EsuMappingProfile, row: number, decoded: EsuRow): IndexedEntry[] {
  const layout = rowLayout(profile, row);
  const encoded = encodeRow(profile, decoded);
  const entries: IndexedEntry[] = [];
  layout.conditionCvs.forEach((cv, i) => {
    entries.push({ cv32: layout.conditionPage, cv, value: encoded.conditions[i] ?? 0 });
  });
  layout.outputCvs.forEach((cv, i) => {
    entries.push({ cv32: layout.outputPage, cv, value: encoded.outputs[i] ?? 0 });
  });
  return entries;
}

export function readRow(
  profile: EsuMappingProfile,
  row: number,
  get: (cv32: number, cv: number) => number | undefined,
): EsuRow | undefined {
  const layout = rowLayout(profile, row);
  const cond: number[] = [];
  const out: number[] = [];
  for (const cv of layout.conditionCvs) {
    const v = get(layout.conditionPage, cv);
    if (v === undefined) return undefined;
    cond.push(v);
  }
  for (const cv of layout.outputCvs) {
    const v = get(layout.outputPage, cv);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return decodeRow(profile, cond, out);
}

export function isRowEmpty(row: EsuRow): boolean {
  return (
    row.physical.length === 0 &&
    row.logic.length === 0 &&
    row.slots.length === 0 &&
    row.conditions.moving === "ignore" &&
    row.conditions.direction === "ignore" &&
    row.conditions.wheelSensor === "ignore" &&
    row.conditions.sensors.every((s) => s === "ignore") &&
    row.conditions.keys.every((k) => k === "ignore")
  );
}

export function cycleCond(state: CondState): CondState {
  if (state === "ignore") return "on";
  if (state === "on") return "off";
  return "ignore";
}

export function decodeDelay(cv: number): { on: number; off: number } {
  return { on: cv & 0x0f, off: (cv >> 4) & 0x0f };
}

export function encodeDelay(on: number, off: number): number {
  const a = Math.min(15, Math.max(0, Math.round(on)));
  const b = Math.min(15, Math.max(0, Math.round(off)));
  return (b << 4) | a;
}

export function clampBrightness(value: number): number {
  return Math.min(31, Math.max(0, Math.round(value)));
}

export interface ApplyBatch {
  cv32: number;
  cvs: { cv: number; value: number }[];
}

/** One `cv.write` per index page: CV31, CV32, then payload in CV order. */
export function applyBatches(diffs: IndexedEntry[]): ApplyBatch[] {
  const byPage = new Map<number, { cv: number; value: number }[]>();
  for (const d of diffs) {
    const list = byPage.get(d.cv32) ?? [];
    list.push({ cv: d.cv, value: d.value });
    byPage.set(d.cv32, list);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cv32, payload]) => ({
      cv32,
      cvs: [
        { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
        { cv: INDEX_CV32, value: cv32 },
        ...payload.sort((a, b) => a.cv - b.cv),
      ],
    }));
}

export type IndexedGet = (cv32: number, cv: number) => number | undefined;

export type IndexPage = { cv32: number; cvs: number[] };

export function mergeIndexPages(pages: IndexPage[]): IndexPage[] {
  const byPage = new Map<number, Set<number>>();
  for (const page of pages) {
    const set = byPage.get(page.cv32) ?? new Set<number>();
    for (const cv of page.cvs) set.add(cv);
    byPage.set(page.cv32, set);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cv32, cvs]) => ({ cv32, cvs: [...cvs].sort((a, b) => a - b) }));
}

export function pagesForRows(profile: EsuMappingProfile, rows: number[]): IndexPage[] {
  return mergeIndexPages(
    rows.flatMap((row) => {
      const layout = rowLayout(profile, row);
      return [
        { cv32: layout.conditionPage, cvs: layout.conditionCvs },
        { cv32: layout.outputPage, cvs: layout.outputCvs },
      ];
    }),
  );
}

/** Physical-output CVs only — enough to see which AUX a row drives. */
export function physicalScanPages(profile: EsuMappingProfile): IndexPage[] {
  const byPage = new Map<number, Set<number>>();
  for (let row = 1; row <= profile.rowCount; row++) {
    const layout = rowLayout(profile, row);
    const phys = layout.outputCvs.slice(0, profile.physicalCvCount);
    const set = byPage.get(layout.outputPage) ?? new Set<number>();
    for (const cv of phys) set.add(cv);
    byPage.set(layout.outputPage, set);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cv32, cvs]) => ({ cv32, cvs: [...cvs].sort((a, b) => a - b) }));
}

export function unreadPages(pages: IndexPage[], get: IndexedGet): IndexPage[] {
  return pages
    .map((page) => ({ cv32: page.cv32, cvs: page.cvs.filter((cv) => get(page.cv32, cv) === undefined) }))
    .filter((page) => page.cvs.length > 0);
}

export function pagesLoaded(
  pages: IndexPage[],
  get: IndexedGet,
): boolean {
  return pages.every((page) => page.cvs.every((cv) => get(page.cv32, cv) !== undefined));
}
