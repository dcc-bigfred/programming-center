# Digital coupler

How the Programming Center **Coupler** page (`/coupler`) programs
electric uncouplers. One nav tile, dispatcher by `?decoder=` — same
pattern as Mapping and Speed.

| Decoder | Page | CVs |
| --- | --- | --- |
| LokSound v4 / v5 | `EsuCouplerPage` | Indexed output mode (CV 32 = 0) + automatic uncoupling **246 / 247 / 248** + F-key via mapping rows |
| ZIMO MS450 | `ZimoCouplerPage` | Effect **48** on FO CVs + packed **115 / 116** |
| NMRA / RailBOX | tile greyed out | — |

Changelists stay main-table only. ESU F-key writes go to the shared
`esu-indexed` side table (same as Mapping).

## ESU (LokSound 5 §12.5.7, V4.0 §12.3.7)

The automatic uncoupling CVs are unique numbers and live on the main
table. Coupler **type** and **strength** are Mode Select / brightness on
the output-config page (CV 31 = 16, CV 32 = 0, CVs 257–511). Those
numbers are reused on mapping pages, so they cannot go in the main
table.

The page registers the same side table as Mapping (`esu-indexed`), but
reads only Mode Select and brightness per output (not delay / auto-off /
special-function CVs). If an output is in coupler mode, it then lazily
reads mapping physical CVs (and full rows that drive that AUX) so the
F-key can be set here. Already-cached mapping pages from `/mapping` are
not read again. Leaving `/coupler` for `/mapping` (or the other way)
does **not** discard; the cache stays. Leaving for any other path with
dirty indexed diffs asks to discard the side table only. Automatic
uncoupling diffs stay.

PWM coupler mode: 100% for 250 ms, then PWM from brightness 0–31. Telex
uses the Krois mode. Setting a type on an AUX is the wire drive, not
the F-key.

| Type | v4 | v5 |
| --- | --- | --- |
| Krois / Telex | mode 28 | 28 |
| ROCO | 29 | 29 |
| ESU coupler (compat.) | — | 21 |
| Servo coupler | 31 (XL AUX7–10) | — (31 is PowerPack) |

Automatic uncoupling (Removing/Pushing): CV 246 = speed (`0` = off),
247 = pull-away, 248 = push. Time = `n × 0.016` s. 247 should be ≥ 248.
Auto-uncouple only works if the output is in coupler (or pulse) mode.

F-key: ESU has no CV “AUX3 = F3”. A dedicated mapping row (this AUX
only) can be edited from `/coupler`. Mixed or multiple rows stay on
**Mapping**.

## ZIMO (MS/MN §3.23)

Effect **48** (bits 7–2) on CV 125 (front), 126 (rear), 127–132 (FO1–6),
159–160 (FO7–8). Direction: 48 both, 49 forward, 50 reverse. Turning
the coupler off writes `0` only when the current value is 48–50; other
effects are left alone.

**CV 115** (shared): tens = full-voltage time
(`0 / 0.1 / 0.2 / 0.4 / 0.8 / 1 / 2 / 3 / 4 / 5` s), ones = hold 0–90%.
Krois presets 60 / 70 / 80 (2 / 3 / 4 s, no hold). Hundreds are not
exposed (manual OCR mixes them with CV 116).

**CV 116**: tens = pull-away time (same table; `0` = no waltz), ones × 4
= internal speed step, hundreds `1` = push in first to unload the
coupler. Example from the manual: 115 = 60, 116 = 155.
