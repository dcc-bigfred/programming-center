# Output mapping — ZIMO MS / MN

How the Programming Center **Mapping** page wires function keys to
lamp outputs. Matches
[ZIMO MS-MN manual](https://www.zimo.at/web2010/documents/MS-MN-Decoders_EN.pdf)
§3.14–3.17.

Two layers:

1. **NMRA (everyday lights)** — CV 33–46. Each key is a bitmask of
   wires. The **M-key** on a Swiss scene **suppresses** that key’s NMRA
   outputs while the scene is on (unless “keep usual lights” is set).
2. **Swiss scenes** — 17 extra lighting groups on top of the keys
   above. Unused groups (F = 0) stay collapsed in the kiosk.

Lighting effects (CV 125+) and the input map (CV 400+) are not on this
page.

Encode/decode lives in `web/src/features/zimoMapping.ts`. Apply is the
ordinary changelist (`cv.write` of staged diffs). **Read** force-reads
every mapping CV; opening the page `ensureRead`s only those still
missing from the registry.

## NMRA keys (CV 33–46)

| CV | Key |
| --- | --- |
| 33 | F0 forward |
| 34 | F0 reverse |
| 35–46 | F1–F12 |

Each value is 8 bits. **CV 61 = 97** turns off the factory left-shift,
so every key uses the same columns:

| Bit | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wire | Front | Rear | FO1 | FO2 | FO3 | FO4 | FO5 | FO6 |

Factory CV 61 (not 97) still shifts F3–F12:

- F0–F2 (CV 33–36): Front, Rear, FO1–FO6 (same as above)
- F3–F6 (CV 37–40): FO2–FO9
- F7–F12 (CV 41–46): FO5–FO12

The kiosk toggle **Allow any key to drive any output** writes 97 or 0
into CV 61. The grid shows Front / Rear / Output 1–12; cells that are
not in that key’s mask are disabled.

Factory F1–F12 defaults are 4, 8, 2, 4, 8, 16, 4, 8, 16, 32, 64, 128
(so each Fn drives FOn once left-shift is applied). CV 33 default 1,
CV 34 default 2.

## Swiss groups (17 × 6 CVs)

| Groups | First CV | Last CV |
| --- | --- | --- |
| 1–13 | 430 + (n−1)×6 | … 507 |
| 14–17 | 800 + (n−14)×6 | … 823 |

Per group, six CVs:

| Offset | Role |
| --- | --- |
| 0 | F-key |
| 1 | M-key |
| 2 | Output 1, forward |
| 3 | Output 2, forward |
| 4 | Output 1, reverse |
| 5 | Output 2, reverse |

**F-key:** 0 = unused group; 1–28 = F1–F28; **29 = F0**. Add **128**
to invert (on when the key is off). Unused groups encode as 0 (invert
is dropped).

**M-key:** bits 0–4 = key (29 = F0); bit 5 = keep NMRA reverse; bit 6 =
keep NMRA forward; bit 7 = require F **and** M. **157** is F0 as
master (29 + 128). **255 = high beam**. 0 = none.

The kiosk label does not say “A1/A2”. Those two wires are **Output 1**
and **Output 2**.

**Output CVs:** bits 0–3 select the wire; bits 5–7 select a dim slot.

| Bits 0–3 | Wire |
| --- | --- |
| 0 | unused |
| 1–13 | FO1–FO13 |
| 14 | Front light (F00f) |
| 15 | Rear light (F00r) |

| Bits 5–7 | Dim |
| --- | --- |
| 0 | none (full) |
| 1–5 | CV 508–512 |

## Dim and high beam

CV **508–512** are five brightness slots. Brightness is bits 3–7:
value `(0–31)×8` (factory **248** = full). Bit 1 = flash, bit 2 =
inverted flash; the kiosk only edits brightness and leaves those bits
as read.

**High beam** is M-key **255** on a scene. **CV 399** is the internal
speed (0–255) above which that scene goes to full brightness. **CV 60**
(global PWM) is shown next to high-beam only.

## Kiosk

- Empty Swiss groups (F = 0) start collapsed; the title is
  **Scene n** or **Scene n — F15**.
- CV numbers stay in a small caption (`CV 430`), not as the primary
  label.
- Apply is the left-nav changelist. No extra WebSocket command.
