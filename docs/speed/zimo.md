# Speed control — ZIMO MS / MN

How the Programming Center **Speed** page maps a throttle step (0–28) to
motor speed, and how long the loco takes to get there. Matches
[ZIMO MS-MN manual](https://www.zimo.at/web2010/documents/MS-MN-Decoders_EN.pdf)
§3.7.

Pick the curve with **CV 29 bit 4**: off = three points, on = 28-point table.

## Three-point curve (CV 2 / 6 / 5)

Three knobs on the throttle:

| CV | Name | Meaning |
| --- | --- | --- |
| 2 | Vstart | Speed at step 1 |
| 6 | Vmid | Speed at step 14 |
| 5 | Vhigh | Speed at full throttle |

CV 5 of **0 or 1 means 255** (full speed). Keep **CV 2 ≤ CV 6 ≤ CV 5**.

ZIMO then **smooths** the four knots (standstill → Vstart → Vmid → Vhigh)
so there is no sharp kink. Mid-notch is meant to sit in the first third of
the throttle, not halfway. The app draws that same smooth line
(Fritsch–Carlson). If CV 6 is left at the default **1**, ZIMO treats mid
speed as about **⅓ of Vhigh** (so Vhigh 255 ≈ mid 85).

## 28-point table (CV 67–94)

Each CV is one throttle step: **CV 67 = step 1 … CV 94 = step 28**. The
value is the internal speed (0–255). In 128-step mode the decoder fills the
gaps by interpolating. The app does the same between neighbouring CVs.

## Acceleration and braking

Times are **stop ↔ full speed**. Distance grows with how fast you were going.

| CV | Role | Seconds |
| --- | --- | --- |
| 3 | Cab accelerate | × **0.9** |
| 4 | Cab brake | × **0.9** |
| 49 | HLU / ABC accelerate | × **0.4** |
| 50 | HLU / ABC brake | × **0.4** |
| 309 | Which function is the **brake key** (0 = off) | — |
| 349 | Brake-key time | × **0.9** |

On **MS/MN**, cab and HLU times are **not added**. The decoder uses the
**higher** of CV 3 vs 49, and of CV 4 vs 50.

A typical coasting setup: large CV 4 (long coast when the throttle goes to
zero) and a **small CV 349** so the brake key still stops short. While the
brake key is on, CV 4 is ignored.

MS momentum follows the **speed curve itself** (not 255 equal motor
steps). A bent curve therefore also bends how the loco speeds up and
slows down.
