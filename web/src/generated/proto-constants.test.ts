import { describe, expect, it } from "vitest";

import {
  CV29_LONG_BIT,
  CV29_LONG_MASK,
  ERROR_CODES,
  LONG_MAX,
  RAILCOM_ADDRS_MAX,
  RAILCOM_PLUS_BIT,
  RAILCOM_PLUS_CV,
  RAILCOM_PLUS_MASK,
  SHORT_MAX,
  TYPE_TELEMETRY_CANCEL,
  TYPE_TELEMETRY_SUBSCRIBE,
  TYPE_TELEMETRY_UPDATE,
} from "./proto-constants";

// These assertions pin the wire contract to the Rust proto. If you change a
// value in `proto/rust/z21` or `pc-proto`, update `proto-constants.ts` to match
// and this test will keep the TS side honest on the CI side.
describe("proto-constants mirror the Rust crates", () => {
  it("matches proto/z21 address constants", () => {
    expect(SHORT_MAX).toBe(127);
    expect(LONG_MAX).toBe(10239);
    expect(CV29_LONG_BIT).toBe(5);
    expect(CV29_LONG_MASK).toBe(0x20);
  });

  it("matches proto/z21 RailCom constants", () => {
    expect(RAILCOM_PLUS_CV).toBe(28);
    expect(RAILCOM_PLUS_BIT).toBe(7);
    expect(RAILCOM_PLUS_MASK).toBe(0x80);
    expect(RAILCOM_ADDRS_MAX).toBe(8);
  });

  it("matches pc-proto error codes", () => {
    expect(ERROR_CODES.PC_DISABLED).toBe("pc_disabled");
    expect(ERROR_CODES.INVALID_ADDRESS).toBe("invalid_address");
    expect(ERROR_CODES.INVALID_LONG_BIT).toBe("invalid_long_bit");
    expect(ERROR_CODES.ADDRESS_REVERTED).toBe("address_reverted");
    expect(ERROR_CODES.PROGRAMMING_FAILED).toBe("programming_failed");
    expect(ERROR_CODES.CANCELLED).toBe("cancelled");
    expect(ERROR_CODES.BAD_PAYLOAD).toBe("bad_payload");
    expect(ERROR_CODES.UNKNOWN_COMMAND).toBe("unknown_command");
    expect(ERROR_CODES.Z21_REQUIRED).toBe("z21_required");
  });

  it("matches pc-proto telemetry types", () => {
    expect(TYPE_TELEMETRY_SUBSCRIBE).toBe("telemetry.subscribe");
    expect(TYPE_TELEMETRY_CANCEL).toBe("telemetry.cancel");
    expect(TYPE_TELEMETRY_UPDATE).toBe("telemetry.update");
  });
});
