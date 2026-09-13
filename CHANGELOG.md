# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.1] — 2026-09-13

First public release of **Programming Center** — a kiosk-friendly web UI and
Axum daemon for DCC decoder programming on the BigFred hub or standalone with
a Z21 command station.

### Added

- **Embedded SPA** — React kiosk UI (EN / PL / DE) with decoder picker, idle
  timeout, and rust-embed static assets in the `programming-center` binary.
- **BigFred mode** — SSO login, layout proxy, command-station picker; CV
  traffic via dcc-bus when `programmingMode` is `bigfred`.
- **Standalone / Z21 mode** — direct UDP programming to `z21.hostname:port`
  (`programmingMode: z21`); no BigFred sign-in required in standalone.
- **CV registry** — accordion CV list per decoder catalog; filter, bulk
  set-from-text, changelist panel, and POM write repeat (configurable).
- **Speed & address** — NMRA 3-point speed curve (CV 2 / 5 / 6), accel/brake
  (CV 3 / 4), short/long DCC address (CV 1, 17/18, CV 29 bit 5).
- **Volume** — master volume 0–100 mapped to decoder-specific CVs (ZIMO,
  ESU LokSound).
- **ZIMO MS/MN** — output mapping UI and digital coupler page.
- **ESU LokSound v4 / v5** — output mapping with side tables, scenes, and
  digital coupler page.
- **RailBOX RB23xx** — firmware update wizard over wireless-programmer IPC
  (Soft-AP discovery and upload job progress).
- **RailCom telemetry** — Z21 polling tab over WebSocket (read-only decoder
  feedback).
- **Configuration** — JSON at `$DATA_DIR/etc/bigfred/programming-center/config.json`
  with hot reload; optional wireless-programmer socket retry.
- **Build & CI** — Makefile (`web-build`, `host`, `dev-*`, musl targets); SPA
  tests in CI; org reusable workflow for tagged **linux/arm64** musl releases;
  ELF version section `.programming-center.version`.

### Assets

Static **linux/arm64** musl binary (`programming-center-linux-arm64`) for hub
deployment (see [bigfred-os](https://github.com/dcc-bigfred/bigfred-os)).
