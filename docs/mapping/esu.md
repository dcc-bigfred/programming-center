# Output mapping — ESU LokSound v4 / v5

How the Programming Center **Mapping** page programs ESU function
mapping. Matches the LokSound 5 Instruction Manual (15th ed., Nov
2022) §12.2–12.5 and the LokSound V4.0 manual (4th ed., May 2012)
§12.2–12.3.

ZIMO stays on a separate page (`zimoMapping.ts`). ESU v4 and v5 share
one page (`EsuMappingPage`) parameterized by a profile in
`web/src/features/esuMapping.ts`.

Indexed CVs **257–511** reuse the same numbers on every CV 32 page, so
they cannot live in the main `CvRegistry` table (a `setCv(257, x)`
would clobber every other page). While **Mapping** is open, the page
registers a side table (`esu-indexed`, keys `16.{cv32}.{cv}` in
sessionStorage) with `CvRegistry`. **Zmiany** then shows a separate ESU
group (`CV257 (str. 3)`) and **Zaaplikuj** writes main diffs first, then
one `cv.write` per dirty page: `CV31=16`, `CV32=page`, then the payload.

The side table is **page-scoped**. Leaving `/mapping` unregisters it, so
Direct CV and a later Apply from `/cv` never write mapping windows.
Unsaved mapping diffs require confirmation; OK discards only the side
table (speed / volume / CV-list edits stay). A clean leave does not
prompt; the read cache stays so coming back does not dump those pages
again. Changelists and backup stay main-only — mapping edits are applied
live, not saved as JSON.

Direct CV never lists 257–511.

Do not dump the whole table on entry. The kiosk reads the current group
of 5 mapping scenes, or output configuration when that tab is opened.

## Index registers

Always **CV 31 = 16** before reading or writing 257–511.

| CV 32 | v4 | v5 |
| --- | --- | --- |
| 0 | Output configuration | Output configuration |
| 1 | Slot volumes (not on this page) | Slot volumes (not on this page) |
| 2–4 | Mapping rows 1–16 / 17–32 / 33–40 (conditions and outputs together) | — |
| 3–7 | — | Mapping conditions, rows 1–16 … 65–72 |
| 8–12 | — | Mapping outputs, same row groups |

The v5 intro text that says “CV 32 may be 0, 1, 2, 3 or 4” is leftover
from v4. Mapping uses pages 3–7 and 8–12.

## Mapping rows

Each row is conditions AND-ed together, then physical outputs, logic
functions, and sound slots. The decoder scans rows top to bottom many
times per second.

| | v4 | v5 |
| --- | --- | --- |
| Rows | 40 | 72 |
| Control CVs | 16 (A–I, K–Q) | 20 (A–J, K–T) |
| Keys | F0–F28 | F0–F31 |
| Physical | Headlight, Rearlight, AUX1–AUX10 | Headlight, Rearlight, AUX1–AUX18 |
| Sound slots | 24 | 32 |

CV numbers are computed (`257 + ((row-1) mod 16) × 16 + offset`). The
v5 master table OCR lists **CV G = 363** on several page-start rows;
the real value is **263**. v4 row 16 ends at **CV 512**.

Condition packing is four On/Off pairs per CV (On=1, Off=2 for the
first pair, then ×4). Forward + F0 on → CV A = 20. Logic-function bits
are **not** a superset between v4 and v5 — the same bit is a different
function.

## Output configuration (CV 32 = 0)

7 CVs per output on v5 (adds Special Function 3 at Mode−1), 6 on v4.
Brightness is 0–31. Switch delay is `(off × 16) + on` (each 0–15).
Special Function CV 1 bits from the manuals: Phase=1, Grade crossing=2,
Rule 17 forward=4, reverse=8, Dimmer=16, LED=128.

Rearlight Special Function CV 2 is **273** on both families (272 is
skipped). Config 2 for Headlight starts at **355** (v4) vs **419** (v5).

Lighting modes 1–17 are shared. Mode Select ≥ 18 is version-specific
(v5 adds random strobe, ESU coupler, sound-controlled smoke, PowerPack;
v4 keeps servo-coupler as 31).

## Out of scope

Project-specific sound-slot names, per-slot volumes (CV 32 = 1),
v4 M4/XL factory maps as a separate UI, and servo programming beyond
Mode Select.
