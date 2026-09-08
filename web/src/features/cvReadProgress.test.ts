import {
  applyProgressFrame,
  createProgressState,
  entryToApply,
  expandCvList,
  overlayVisibleSlots,
  OVERLAY_WINDOW,
  progressValue,
} from "./cvReadProgress";

describe("cvReadProgress", () => {
  it("expands a list and a range, skipping address CVs", () => {
    expect(expandCvList([3, 1, 3])).toEqual([1, 3]);
    const got = expandCvList([], 1, 20, true);
    expect(got).not.toContain(1);
    expect(got).not.toContain(17);
    expect(got[0]).toBe(2);
    expect(got[got.length - 1]).toBe(20);
    expect(expandCvList([5], 1, 3)).toEqual([1, 2, 3, 5]);
    expect(expandCvList([])).toEqual([]);
  });

  it("marks reading then ok / failed and exposes live values", () => {
    let state = createProgressState("r1", [33, 34, 35], true);
    expect(state.slots.map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    state = applyProgressFrame(state, { total: 3, done: 0, current: 33 });
    expect(state.streaming).toBe(true);
    expect(state.slots[0]?.status).toBe("reading");
    expect(progressValue({ total: 3, done: 1, cv: 33, value: 4 })).toEqual({ cv: 33, value: 4 });
    state = applyProgressFrame(state, { total: 3, done: 1, cv: 33, value: 4 });
    expect(state.slots[0]?.status).toBe("ok");
    expect(state.done).toBe(1);
    state = applyProgressFrame(state, { total: 3, done: 2, cv: 34, failed: true });
    expect(state.slots[1]?.status).toBe("failed");
    expect(progressValue({ total: 3, done: 2, cv: 34, failed: true })).toBeNull();
  });

  it("does not apply values when liveApply is off or the request was cancelled", () => {
    const got = { total: 2, done: 1, cv: 8, value: 145 };
    expect(entryToApply(true, false, got)).toEqual({ cv: 8, value: 145 });
    expect(entryToApply(false, false, got)).toBeNull();
    expect(entryToApply(true, true, got)).toBeNull();
  });

  it("windows a long dump instead of listing every CV", () => {
    const cvs = Array.from({ length: 200 }, (_, i) => i + 1);
    let state = createProgressState("r2", cvs, false);
    expect(overlayVisibleSlots(state).length).toBe(OVERLAY_WINDOW);
    state = applyProgressFrame(state, { total: 200, done: 99, current: 100 });
    const vis = overlayVisibleSlots(state);
    expect(vis.length).toBeLessThanOrEqual(OVERLAY_WINDOW);
    expect(vis.some((s) => s.cv === 100 && s.status === "reading")).toBe(true);
  });
});
