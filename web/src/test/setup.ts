import "@testing-library/jest-dom/vitest";

import { resetCvTable } from "../cv/table";
import { resetIndexedCvTable } from "../cv/indexedTable";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

if (typeof sessionStorage === "undefined" || typeof sessionStorage.clear !== "function") {
  vi.stubGlobal("sessionStorage", memoryStorage());
}
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  vi.stubGlobal("localStorage", memoryStorage());
}

beforeEach(() => {
  resetCvTable();
  resetIndexedCvTable();
  sessionStorage?.clear?.();
  localStorage?.clear?.();
});
