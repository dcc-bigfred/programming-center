# RB23xx firmware update

How the Programming Center **Firmware** page (`/firmware`) uploads a
`.bin` image to a RailBOX RB23xx decoder. The tile is only enabled when
the selected decoder is RailBOX RB23xx (`rb23xx`; aliases `rb2300` /
`rb2302`).

wireless-programmer does **not** list images or toggle F28. It scans
Soft-AP and uploads a path that already exists on the hub disk.

## Operator flow

1. **Turn on decoder WiFi** — `function.set` F28 on (ops track, not a
   pulse). Soft-AP SSIDs: `RB2300_`, `RB2310_`, `RB2302_`.
2. **Scan** — `firmware.scan` → wireless-programmer `scan` mode `ap`,
   filtered to `driver === "rb23xx"`. Pick SSID + BSSID.
3. **File** — pick a basename from `$DATA_DIR/var/railbox/rb23xx/firmware/*.bin`
   and **Upload** (`firmware.update` + `firmware.watch`). Upload can
   take up to ~120 s.
4. **Turn off decoder WiFi** — `function.set` F28 off.

If `wirelessProgrammer.enabled` is false or the IPC socket is down, the
page shows an alert. Steps 2–3 are blocked. F28 (steps 1 and 4) still
works — it uses Z21 LAN or dcc-bus `loco.setFunction`, not the programmer
daemon.

## Hub files

Put images on the programming-center host:

```
$DATA_DIR/var/railbox/rb23xx/firmware/*.bin
```

The SPA sends only the file name. The daemon joins that name under the
directory and rejects `..` / `/` / anything that is not `*.bin`. The
absolute path is what wireless-programmer `updateFirmware` reads (IPC
frames are capped at 1 MiB; the image stays on disk).

## Config

```json
"wirelessProgrammer": {
  "enabled": true,
  "socketConnectRetryInterval": 60
}
```

`enabled` defaults to true. The daemon retries `hello` on
`run/wireless-programmer/wireless-programmer.sock` every
`socketConnectRetryInterval` seconds with a **2 s** connect timeout
(not in JSON). Hot-reload applies without a process restart.
`GET /api/v1/pc/config` exposes `{ enabled, connected }` so the SPA can
show the alert without an extra HTTP call.
