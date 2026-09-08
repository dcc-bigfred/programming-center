import { ADDRESS_CVS } from "./dccAddress";

export const CV_MIN = 1;
export const CV_MAX = 1024;
export const OVERLAY_LIST_FULL_MAX = 80;
export const OVERLAY_WINDOW = 21;

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
  slots: CvProgressSlot[];
}

export function validCv(cv: number): boolean {
  return Number.isInteger(cv) && cv >= CV_MIN && cv <= CV_MAX;
}

/** Same union as pc-core `expand_cv_list`. */
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
    slots: cvs.map((cv) => ({ cv, status: "pending" })),
  };
}

export function applyProgressFrame(
  state: ReadProgressState,
  payload: CvProgressPayload,
): ReadProgressState {
  const slots = state.slots.map((s) => ({ ...s }));
  const mark = (cv: number, status: CvSlotStatus) => {
    const row = slots.find((s) => s.cv === cv);
    if (row) row.status = status;
  };
  if (payload.current !== undefined) {
    mark(payload.current, "reading");
  }
  if (payload.cv !== undefined) {
    mark(payload.cv, payload.failed ? "failed" : "ok");
  }
  return {
    ...state,
    streaming: true,
    total: payload.total,
    done: payload.done,
    current: payload.current ?? payload.cv ?? state.current,
    slots,
  };
}

export function overlayVisibleSlots(state: ReadProgressState): CvProgressSlot[] {
  if (state.slots.length <= OVERLAY_LIST_FULL_MAX) return state.slots;
  const reading = state.slots.findIndex((s) => s.status === "reading");
  const i = reading >= 0 ? reading : Math.min(state.done, state.slots.length - 1);
  const half = Math.floor(OVERLAY_WINDOW / 2);
  let start = Math.max(0, i - half);
  let end = Math.min(state.slots.length, start + OVERLAY_WINDOW);
  if (end - start < OVERLAY_WINDOW) {
    start = Math.max(0, end - OVERLAY_WINDOW);
  }
  return state.slots.slice(start, end);
}

export function progressValue(payload: CvProgressPayload): { cv: number; value: number } | null {
  if (payload.cv === undefined || payload.value === undefined || payload.failed) {
    return null;
  }
  return { cv: payload.cv, value: payload.value };
}

/** Live table apply: skip backup dumps and cancelled requests. */
export function entryToApply(
  liveApply: boolean,
  ignored: boolean,
  payload: CvProgressPayload,
): { cv: number; value: number } | null {
  if (!liveApply || ignored) return null;
  return progressValue(payload);
}
