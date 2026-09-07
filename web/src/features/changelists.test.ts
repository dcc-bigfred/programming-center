import {
  changeListEpoch,
  decoderKey,
  notifyChangeListsChanged,
  subscribeChangeLists,
} from "./changelists";

describe("changelists", () => {
  it("stores lists under the canonical decoder id", () => {
    expect(decoderKey("rb2300")).toBe("rb23xx");
    expect(decoderKey("zimo-ms450")).toBe("zimo-ms450");
  });

  it("notifies subscribers when a list is saved or deleted", () => {
    const seen: number[] = [];
    const stop = subscribeChangeLists(() => seen.push(changeListEpoch()));
    notifyChangeListsChanged();
    notifyChangeListsChanged();
    stop();
    notifyChangeListsChanged();
    expect(seen).toEqual([1, 2]);
  });
});

