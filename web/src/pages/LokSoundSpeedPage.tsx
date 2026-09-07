import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import DragLineChart from "../components/DragLineChart";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import type { DecoderProfile } from "../decoders/types";
import { optionalT } from "../i18n";
import {
  BRAKE_LIMIT_CVS,
  BRAKE_REDUCE_CVS,
  EDITABLE_TABLE_CVS,
  MID_STEP,
  SPEED_STEPS,
  THREE_POINT_CVS,
  allSpeedReadCvs,
  applyTrim,
  bitopForSpeedTable,
  brakeReducedCv,
  cabSeconds,
  clampByte,
  clampThreePoint,
  defaultTable28,
  inverseTrim,
  is28PointTable,
  sampleMomentum,
  sampleSpeedCurve,
  scaleTableValue,
  scaledTable,
  secondsToCabCv,
  tableFromValues,
  threeFromValues,
  timeAxisMax,
  unscaleTableValue,
  type CurveMode,
} from "../features/esuLoksoundSpeed";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

function initialValues(): Record<number, number> {
  const table = defaultTable28();
  const values: Record<number, number> = {
    2: 3,
    6: 151,
    5: 255,
    3: 28,
    4: 21,
    23: 0,
    24: 0,
    179: 80,
    180: 40,
    181: 40,
    182: 0,
    183: 126,
    184: 126,
  };
  table.forEach((raw, i) => {
    values[67 + i] = raw;
  });
  return values;
}

export default function LokSoundSpeedPage({
  decoder,
  session,
}: {
  decoder: DecoderProfile;
  session: Session;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const registry = useCvRegistry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const defaults = useMemo(() => initialValues(), []);

  const values = useMemo(() => {
    const next = { ...defaults };
    for (const cv of Object.keys(defaults).map(Number)) {
      const got = registry.get(cv);
      if (got !== undefined) next[cv] = got;
    }
    return next;
  }, [defaults, registry.diffs]);

  const cab = theme.palette.primary.main;
  const fn1 = theme.palette.warning.main;
  const fn2 = theme.palette.secondary.main;
  const fn3 = theme.palette.error.main;

  const cv29 = registry.get(29) ?? 0;
  const mode: CurveMode = is28PointTable(cv29) ? "table" : "three";
  const three = threeFromValues(values);
  const tableRaw = tableFromValues(values);
  const scaled = scaledTable(tableRaw, three.vstart, three.vhigh);
  const vmax = mode === "table" ? (scaled[SPEED_STEPS - 1] ?? three.vhigh) : three.vhigh;

  const cv3eff = applyTrim(values[3] ?? 0, values[23] ?? 0);
  const cv4eff = applyTrim(values[4] ?? 0, values[24] ?? 0);
  const t3 = cabSeconds(cv3eff);
  const t4 = cabSeconds(cv4eff);
  const brakeTimes = BRAKE_REDUCE_CVS.map((cv) =>
    cabSeconds(brakeReducedCv(cv4eff, values[cv] ?? 0)),
  );
  const accelMax = timeAxisMax([t3]);
  const brakeMax = timeAxisMax([t4, ...brakeTimes]);

  const speedSeries = useMemo(
    () => [{ id: "curve", color: cab, points: sampleSpeedCurve(mode, three, scaled) }],
    [cab, mode, three, scaled],
  );

  const speedHandles = useMemo(() => {
    if (mode === "three") {
      return [
        { id: "cv2", x: 1, y: three.vstart, color: cab, axis: "y" as const },
        { id: "cv6", x: MID_STEP, y: three.vmid, color: cab, axis: "y" as const },
        { id: "cv5", x: SPEED_STEPS, y: three.vhigh, color: cab, axis: "y" as const },
      ];
    }
    return EDITABLE_TABLE_CVS.map((cv) => {
      const i = cv - 67;
      return {
        id: `cv${cv}`,
        x: i + 1,
        y: scaleTableValue(tableRaw[i] ?? 0, three.vstart, three.vhigh),
        color: cab,
        axis: "y" as const,
      };
    });
  }, [cab, mode, three, tableRaw]);

  const accelSeries = useMemo(
    () => [
      {
        id: "cab",
        color: cab,
        points: sampleMomentum(mode, three, scaled, t3, false),
      },
    ],
    [cab, mode, three, scaled, t3],
  );

  const brakeColors = [fn1, fn2, fn3];
  const brakeSeries = useMemo(
    () => [
      {
        id: "cab",
        color: cab,
        points: sampleMomentum(mode, three, scaled, t4, true),
      },
      ...BRAKE_REDUCE_CVS.map((_cv, i) => ({
        id: `fn${i + 1}`,
        color: brakeColors[i] ?? fn1,
        dash: i === 0 ? "8 5" : i === 1 ? "3 4" : "1 4",
        points: sampleMomentum(
          mode,
          three,
          scaled,
          brakeTimes[i] ?? 0,
          true,
          values[BRAKE_LIMIT_CVS[i]] ?? 0,
        ),
      })),
    ],
    [cab, fn1, fn2, fn3, mode, three, scaled, t4, brakeTimes, values],
  );

  const patch = (cv: number, value: number) => {
    registry.set(cv, value);
  };

  const patchThree = (next: { vstart: number; vmid: number; vhigh: number }) => {
    registry.setMany([
      { cv: 2, value: next.vstart },
      { cv: 6, value: next.vmid },
      { cv: 5, value: next.vhigh },
    ]);
  };

  const readAll = async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      await programming.withReadOverlay(signal, async (inner) => {
        const first = await programming.cvRead({
          ...session,
          cvs: [29],
          signal: inner,
        });
        registry.rememberRead(first.cvs);
        const rest = allSpeedReadCvs().filter((cv) => cv !== 29);
        const cvs = await programming.cvRead({
          ...session,
          cvs: rest,
          signal: inner,
        });
        registry.rememberRead(cvs.cvs);
      });
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    void registry.ensureRead(allSpeedReadCvs(), ac.signal).catch((err) => {
      if (!isCancelled(err)) setError(err);
    });
    return () => ac.abort();
    // Station / address only: track is transport, CVs stay in the registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.stationId, session.address]);

  const onSpeedHandle = (id: string, _x: number, y: number) => {
    const v = Math.min(255, Math.max(0, y));
    if (id === "cv2") {
      patchThree(clampThreePoint(three, 2, v));
      return;
    }
    if (id === "cv6") {
      patchThree(clampThreePoint(three, 6, v));
      return;
    }
    if (id === "cv5") {
      patchThree(clampThreePoint(three, 5, v));
      return;
    }
    const cv = Number(id.replace("cv", ""));
    if (EDITABLE_TABLE_CVS.includes(cv)) {
      patch(cv, unscaleTableValue(v, three.vstart, three.vhigh));
    }
  };

  const speedFields = mode === "three" ? [...THREE_POINT_CVS] : [2, 5, ...EDITABLE_TABLE_CVS];

  return (
    <Stack spacing={3}>
      {error ? <ErrorAlert error={error} /> : null}
      <ToggleButtonGroup
        exclusive
        value={mode}
        onChange={(_, next: CurveMode | null) => {
          if (!next) return;
          void (async () => {
            try {
              await registry.ensureRead([29]);
            } catch (err) {
              if (!isCancelled(err)) setError(err);
              return;
            }
            const bitop = bitopForSpeedTable(next === "table");
            registry.setBits(29, bitop.andMask, bitop.orMask);
          })();
        }}
      >
        <ToggleButton value="three">{t("speed.esu.threePoint")}</ToggleButton>
        <ToggleButton value="table">{t("speed.esu.table28")}</ToggleButton>
      </ToggleButtonGroup>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("speed.esu.curveTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: "0.9rem" }}>
          {mode === "table" ? t("speed.esu.tableNote") : t("speed.esu.threeNote")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={SPEED_STEPS}
          yMin={0}
          yMax={255}
          xLabel={t("speed.esu.throttle")}
          yLabel={t("speed.esu.internalSpeed")}
          series={speedSeries}
          handles={speedHandles}
          onMove={onSpeedHandle}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {speedFields.map((cv) => (
            <CvValueField
              key={cv}
              decoder={decoder}
              cv={cv}
              value={values[cv] ?? 0}
              onChange={(n) => {
                if (mode === "three" && (cv === 2 || cv === 6 || cv === 5)) {
                  patchThree(clampThreePoint(three, cv, n));
                  return;
                }
                patch(cv, n);
              }}
            />
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("speed.esu.accelTitle")}
        </Typography>
        <Legend items={[{ color: cab, label: t("speed.esu.cab") }]} />
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: "0.9rem" }}>
          {t("speed.esu.accelNote")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={accelMax}
          yMin={0}
          yMax={255}
          xLabel={t("speed.esu.time")}
          yLabel={t("speed.esu.internalSpeed")}
          series={accelSeries}
          handles={[{ id: "cv3", x: t3, y: vmax, color: cab, axis: "x" }]}
          onMove={(id, x) => {
            if (id === "cv3") {
              patch(3, inverseTrim(secondsToCabCv(Math.max(0, x)), values[23] ?? 0));
            }
          }}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <CvValueField decoder={decoder} cv={3} value={values[3] ?? 0} onChange={(n) => patch(3, n)} />
          <CvValueField decoder={decoder} cv={23} value={values[23] ?? 0} onChange={(n) => patch(23, n)} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("speed.esu.brakeTitle")}
        </Typography>
        <Legend
          items={[
            { color: cab, label: t("speed.esu.cab") },
            { color: fn1, label: t("speed.esu.brakeFn", { n: 1 }), dash: true },
            { color: fn2, label: t("speed.esu.brakeFn", { n: 2 }), dash: true },
            { color: fn3, label: t("speed.esu.brakeFn", { n: 3 }), dash: true },
          ]}
        />
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: "0.9rem" }}>
          {t("speed.esu.brakeNote")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={brakeMax}
          yMin={0}
          yMax={255}
          xLabel={t("speed.esu.time")}
          yLabel={t("speed.esu.internalSpeed")}
          series={brakeSeries}
          handles={[{ id: "cv4", x: t4, y: 0, color: cab, axis: "x" }]}
          onMove={(id, x) => {
            if (id === "cv4") {
              patch(4, inverseTrim(secondsToCabCv(Math.max(0, x)), values[24] ?? 0));
            }
          }}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <CvValueField decoder={decoder} cv={4} value={values[4] ?? 0} onChange={(n) => patch(4, n)} />
          <CvValueField decoder={decoder} cv={24} value={values[24] ?? 0} onChange={(n) => patch(24, n)} />
          {BRAKE_REDUCE_CVS.map((cv) => (
            <CvValueField
              key={cv}
              decoder={decoder}
              cv={cv}
              value={values[cv] ?? 0}
              onChange={(n) => patch(cv, n)}
            />
          ))}
          {BRAKE_LIMIT_CVS.map((cv) => (
            <CvValueField
              key={cv}
              decoder={decoder}
              cv={cv}
              value={values[cv] ?? 0}
              onChange={(n) => patch(cv, clampByte(n))}
            />
          ))}
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
          {t("speed.readAll")}
        </Button>
      </Stack>
    </Stack>
  );
}

function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mb: 1 }}>
      {items.map((item) => (
        <Stack key={item.label} direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              width: 22,
              height: 0,
              borderTop: item.dash ? `3px dashed ${item.color}` : `3px solid ${item.color}`,
            }}
          />
          <Typography variant="body2">{item.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function CvValueField({
  decoder,
  cv,
  value,
  onChange,
}: {
  decoder: DecoderProfile;
  cv: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const item = decoder.cvs.find((c) => c.cv === cv);
  const min = item?.min ?? 0;
  const max = item?.max ?? 255;
  const description = optionalT(item?.descriptionKey, item?.descriptionParams);
  const hint = optionalT(item?.hintKey);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "flex-start" }}>
      <Typography sx={{ fontWeight: 700, minWidth: 72, pt: { sm: 1 } }}>CV{cv}</Typography>
      <TextField
        type="number"
        size="small"
        inputProps={{ min, max }}
        value={value}
        sx={{ width: 104 }}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isInteger(n)) return;
          if (n < min || n > max) return;
          onChange(n);
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography>{description ?? ""}</Typography>
        {hint ? (
          <Typography color="text.secondary" sx={{ fontSize: "0.85rem" }}>
            {hint}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}
