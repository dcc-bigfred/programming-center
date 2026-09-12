// GENERATED — mirror of `proto/rust/z21/src/lib.rs` and `pc-proto/src/lib.rs`.
//
// These values are the wire contract between the Rust backend and this SPA.
// They MUST stay in sync with the Rust crates. The guard test
// (`proto-constants.test.ts`) pins the numeric values; when you change a
// constant in proto, update it here and the test will catch a drift on the
// CI side once a Rust-side assertion is added (see ARCHITECTURE.md).
//
// Regeneration is currently manual; a `tools/gen-proto-constants.mjs` that
// parses the Rust source can be added later to automate this.

export const SHORT_MAX = 127;
export const LONG_MAX = 10239;
export const CV29_LONG_BIT = 5;
export const CV29_LONG_MASK = 1 << CV29_LONG_BIT;

export const RAILCOM_PLUS_CV = 28;
export const RAILCOM_PLUS_BIT = 7;
export const RAILCOM_PLUS_MASK = 1 << RAILCOM_PLUS_BIT;
export const RAILCOM_ADDRS_MAX = 8;

export const TYPE_TELEMETRY_SUBSCRIBE = "telemetry.subscribe";
export const TYPE_TELEMETRY_CANCEL = "telemetry.cancel";
export const TYPE_TELEMETRY_UPDATE = "telemetry.update";
export const TYPE_FUNCTION_SET = "function.set";
export const TYPE_FIRMWARE_STATUS = "firmware.status";
export const TYPE_FIRMWARE_LIST = "firmware.list";
export const TYPE_FIRMWARE_SCAN = "firmware.scan";
export const TYPE_FIRMWARE_UPDATE = "firmware.update";
export const TYPE_FIRMWARE_WATCH = "firmware.watch";
export const TYPE_FIRMWARE_CANCEL = "firmware.cancel";
export const TYPE_FIRMWARE_PROGRESS = "firmware.progress";

export const RB23XX_WIFI_FUNCTION = 28;

/** `Ack.error` codes — keep in sync with `pc-proto::CODE_*`. */
export const ERROR_CODES = {
  PC_DISABLED: "pc_disabled",
  INVALID_ADDRESS: "invalid_address",
  INVALID_LONG_BIT: "invalid_long_bit",
  ADDRESS_REVERTED: "address_reverted",
  PROGRAMMING_FAILED: "programming_failed",
  CANCELLED: "cancelled",
  BAD_PAYLOAD: "bad_payload",
  UNKNOWN_COMMAND: "unknown_command",
  Z21_REQUIRED: "z21_required",
  WP_UNAVAILABLE: "wireless_programmer_unavailable",
  INVALID_FUNCTION: "invalid_function",
  INVALID_FIRMWARE_FILE: "invalid_firmware_file",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
