import "@testing-library/jest-dom/vitest";

import { resetIndexedCvTable } from "../cv/indexedTable";
import { resetCvTable } from "../cv/table";

// jsdom AbortSignal is not undici's AbortSignal. React Router's data router
// does `new Request(url, { signal })` and undici throws. Drop the signal in tests.
{
  const NodeRequest = globalThis.Request;
  function TestRequest(input: RequestInfo | URL, init?: RequestInit) {
    if (init && "signal" in init) {
      const { signal: _ignored, ...rest } = init;
      return new NodeRequest(input, rest);
    }
    return new NodeRequest(input, init);
  }
  TestRequest.prototype = NodeRequest.prototype;
  Object.defineProperty(globalThis, "Request", { configurable: true, value: TestRequest });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "Request", { configurable: true, value: TestRequest });
  }
}

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
