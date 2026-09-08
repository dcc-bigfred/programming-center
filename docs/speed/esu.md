# Speed control — ESU LokSound 5

How the Programming Center **Speed** page maps a throttle step (0–28) to
motor speed, and how long the loco takes to get there. Matches
[ESU LokSound 5](https://www.esu.eu/) §1 / Appendix B (LokSound **5 DCC**
timing).

Pick the curve with **CV 29 bit 4**: off = three points, on = 28-point table.

## Three-point curve (CV 2 / 6 / 5)

Three knobs on the throttle:

| CV | Name | Meaning |
| --- | --- | --- |
| 2 | Vmin | Speed at step 1 |
| 6 | Vmid | Speed at step 14 |
| 5 | Vmax | Speed at full throttle |

Keep a **strict order: CV 2 < CV 6 < CV 5**. Equal or reversed values make
the motor behave erratically. The app draws a smooth line through
standstill, Vmin, Vmid and Vmax.

## 28-point table (CV 67–94)

**CV 67 is always 1** and **CV 94 is always 255**. You only shape the 26
points in between. Those raw values are then **stretched** between CV 2
and CV 5:

```
motor = Vmin + (raw − 1) × (Vmax − Vmin) / 254
```

So CV 2 / 5 set the floor and ceiling; the table only sets the *shape*.
Dragging a point on the chart writes the unstretched raw CV.

## Acceleration and braking (LokSound 5 DCC)

Times are **stop ↔ Vmax**. Distance grows with speed.

```
seconds = CV × 0.896
```

(That is the NMRA unit. Multi-protocol LokSound 5 uses 0.25 s instead —
this page does not.)

**CV 23** trims CV 3, **CV 24** trims CV 4 (NMRA: 0–127 add, 128–255
subtract):

```
effective = CV 3/4  ±  trim
```

The chart shows the **effective** time. Moving the handle writes CV 3/4
so that, after trim, you get the seconds you asked for.

## Function brakes (CV 179–184)

Three independent brakes. Each one **shortens CV 4** and may **cap**
speed while the function is on:

```
brake time CV = CV4_effective × (255 − reduction) / 255
```

| Brake | Shorter time | Speed cap (0 = stop) |
| --- | --- | --- |
| 1 | CV 179 | CV 182 |
| 2 | CV 180 | CV 183 |
| 3 | CV 181 | CV 184 |

Example: effective CV 4 = 60 and CV 179 = 90 → brake-1 time ≈ 39. A high
reduction means a **shorter** stop. A cap of 0 means the function brakes
all the way to standstill.
