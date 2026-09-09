import { describe, expect, it } from "vitest";

import { changedPlusChoice } from "./useAddressProgrammer";

describe("changedPlusChoice", () => {
  it("returns undefined when nothing was read", () => {
    expect(changedPlusChoice(null, true)).toBeUndefined();
    expect(changedPlusChoice(null, false)).toBeUndefined();
  });

  it("returns undefined when no choice was made", () => {
    expect(changedPlusChoice(true, null)).toBeUndefined();
    expect(changedPlusChoice(false, null)).toBeUndefined();
  });

  it("returns undefined when the choice matches what was read", () => {
    expect(changedPlusChoice(true, true)).toBeUndefined();
    expect(changedPlusChoice(false, false)).toBeUndefined();
  });

  it("returns the new choice when it differs from the read value", () => {
    expect(changedPlusChoice(true, false)).toBe(false);
    expect(changedPlusChoice(false, true)).toBe(true);
  });
});
