import { ADDRESS_CVS } from "./dccAddress";

export const CV_MIN = 1;
export const CV_MAX = 1024;
const OVERLAY_LIST_FULL_MAX = 80;
export const OVERLAY_WINDOW = 21;

const STATUS: CvSlotStatus[] = ["pending", "reading", "ok", "failed"];

export type CvSlotStatus = "pending" | "reading" | "ok" | "failed";

export interface CvProgressSlot {
  cv: number;
  status: CvSlotStatus;
}

export interface CvProgressPayload {
  total: number;
  done: number;
  current?: number;
  cv?: number;
  value?: number;
  failed?: boolean;
}

export interface ReadProgressState {
  requestId: string;
  liveApply: boolean;
  streaming: boolean;
  total: number;
  done: number;
  current: number | null;
  cvs: number[];
  /** 0 pending, 1 reading, 2 ok, 3 failed — same order as `cvs`. */
  status: Uint8Array;
  index: Map<number, number>;
}

export function validCv(cv: number): boolean {
  return Number.isInteger(cv) && cv >= CV_MIN && cv <= CV_MAX;
}

/** Same union as `pc-core::expand_cv_list` (list ∪ from–to, optional skip of CV 1/17/18/29). */
export function expandCvList(
  cvs: number[] | undefined,
  from?: number,
  to?: number,
  skipAddress?: boolean,
): number[] {
  const list = cvs ?? [];
  if (from === undefined && to === undefined) {
    if (list.length === 0) return [];
  } else if (from === undefined || to === undefined || from > to) {
    return [];
  }
  if (!list.every(validCv)) return [];
  if (from !== undefined && to !== undefined && (!validCv(from) || !validCv(to))) {
    return [];
  }
  const set = new Set<number>(list);
  if (from !== undefined && to !== undefined) {
    for (let n = from; n <= to; n++) set.add(n);
  }
  if (skipAddress) {
    for (const n of ADDRESS_CVS) set.delete(n);
  }
  return [...set].sort((a, b) => a - b);
}

export function createProgressState(
  requestId: string,
  cvs: number[],
  liveApply: boolean,
): ReadProgressState {
  return {
    requestId,
    liveApply,
    streaming: false,
    total: cvs.length,
    done: 0,
    current: cvs[0] ?? null,
    cvs,
    status: new Uint8Array(cvs.length),
    index: new Map(cvs.map((cv, i) => [cv, i])),
  };
}

export function applyProgressFrame(
  state: ReadProgressState,
  payload: CvProgressPayload,
): ReadProgressState {
  const mark = (cv: number, code: number) => {
    const i = state.index.get(cv);
    if (i !== undefined) state.status[i] = code;
  };
  if (payload.current !== undefined) mark(payload.current, 1);
  if (payload.cv !== undefined) mark(payload.cv, payload.failed ? 3 : 2);
  return {
    ...state,
    streaming: true,
    total: payload.total,
    done: payload.done,
    current: payload.current ?? payload.cv ?? state.current,
  };
}

export function progressSlots(state: ReadProgressState): CvProgressSlot[] {
  return state.cvs.map((cv, i) => ({
    cv,
    status: STATUS[state.status[i] ?? 0] ?? "pending",
  }));
}

export function overlayVisibleSlots(state: ReadProgressState): CvProgressSlot[] {
  const slots = progressSlots(state);
  if (slots.length <= OVERLAY_LIST_FULL_MAX) return slots;
  const reading = slots.findIndex((s) => s.status === "reading");
  const i = reading >= 0 ? reading : Math.min(state.done, slots.length - 1);
  const half = Math.floor(OVERLAY_WINDOW / 2);
  let start = Math.max(0, i - half);
  let end = Math.min(slots.length, start + OVERLAY_WINDOW);
  if (end - start < OVERLAY_WINDOW) {
    start = Math.max(0, end - OVERLAY_WINDOW);
  }
  return slots.slice(start, end);
}

export function progressValue(payload: CvProgressPayload): { cv: number; value: number } | null {
  if (payload.cv === undefined || payload.value === undefined || payload.failed) {
    return null;
  }
  return { cv: payload.cv, value: payload.value };
}

/** Live table apply: skip backup dumps (`liveApply: false`). */
export function entryToApply(
  liveApply: boolean,
  payload: CvProgressPayload,
): { cv: number; value: number } | null {
  if (!liveApply) return null;
  return progressValue(payload);
}
