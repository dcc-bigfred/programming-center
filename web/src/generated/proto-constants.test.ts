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
  TYPE_FUNCTION_SET,
  TYPE_FIRMWARE_STATUS,
  TYPE_FIRMWARE_LIST,
  TYPE_FIRMWARE_SCAN,
  TYPE_FIRMWARE_UPDATE,
  TYPE_FIRMWARE_WATCH,
  TYPE_FIRMWARE_CANCEL,
  TYPE_FIRMWARE_PROGRESS,
  RB23XX_WIFI_FUNCTION,
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
    expect(ERROR_CODES.WP_UNAVAILABLE).toBe("wireless_programmer_unavailable");
    expect(ERROR_CODES.INVALID_FUNCTION).toBe("invalid_function");
    expect(ERROR_CODES.INVALID_FIRMWARE_FILE).toBe("invalid_firmware_file");
  });

  it("matches pc-proto telemetry types", () => {
    expect(TYPE_TELEMETRY_SUBSCRIBE).toBe("telemetry.subscribe");
    expect(TYPE_TELEMETRY_CANCEL).toBe("telemetry.cancel");
    expect(TYPE_TELEMETRY_UPDATE).toBe("telemetry.update");
  });

  it("matches pc-proto firmware types", () => {
    expect(TYPE_FUNCTION_SET).toBe("function.set");
    expect(TYPE_FIRMWARE_STATUS).toBe("firmware.status");
    expect(TYPE_FIRMWARE_LIST).toBe("firmware.list");
    expect(TYPE_FIRMWARE_SCAN).toBe("firmware.scan");
    expect(TYPE_FIRMWARE_UPDATE).toBe("firmware.update");
    expect(TYPE_FIRMWARE_WATCH).toBe("firmware.watch");
    expect(TYPE_FIRMWARE_CANCEL).toBe("firmware.cancel");
    expect(TYPE_FIRMWARE_PROGRESS).toBe("firmware.progress");
    expect(RB23XX_WIFI_FUNCTION).toBe(28);
  });
});
