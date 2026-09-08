import { requestId } from "./ws";

describe("requestId", () => {
  it("returns a UUID even when randomUUID is missing (LAN HTTP)", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error — simulate insecure origin
    delete crypto.randomUUID;
    try {
      const id = requestId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      crypto.randomUUID = original;
    }
  });
});
