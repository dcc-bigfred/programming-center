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
  MID_STEP,
  SPEED_STEPS,
  TABLE_CVS,
  THREE_POINT_CVS,
  VHIGH_CV,
  VMID_CV,
  VSTART_CV,
  allSpeedReadCvs,
  bitopForSpeedTable,
  cabSeconds,
  clampByte,
  clampThreePoint,
  defaultTable28,
  effectiveVhigh,
  hluSeconds,
  is28PointTable,
  sampleMomentum,
  sampleSpeedCurve,
  secondsToCabCv,
  secondsToHluCv,
  speedAtStep,
  tableFromValues,
  threeFromValues,
  timeAxisMax,
  type CurveMode,
} from "../features/zimoSpeed";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

function initialValues(): Record<number, number> {
  const table = defaultTable28();
  const values: Record<number, number> = {
    [VSTART_CV]: 1,
    [VMID_CV]: 1,
    [VHIGH_CV]: 0,
    3: 2,
    4: 1,
    49: 0,
    50: 0,
    309: 0,
    349: 0,
  };
  TABLE_CVS.forEach((cv, i) => {
    values[cv] = table[i] ?? 0;
  });
  return values;
}

export default function ZimoSpeedPage({
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
  const hlu = theme.palette.warning.main;
  const brake = theme.palette.secondary.main;

  const cv29 = registry.get(29) ?? 0;
  const mode: CurveMode = is28PointTable(cv29) ? "table" : "three";
  const three = threeFromValues(values);
  const table = tableFromValues(values);
  const vmax = speedAtStep(SPEED_STEPS, mode, three, table);

  const t3 = cabSeconds(values[3] ?? 0);
  const t4 = cabSeconds(values[4] ?? 0);
  const t49 = hluSeconds(values[49] ?? 0);
  const t50 = hluSeconds(values[50] ?? 0);
  const t349 = cabSeconds(values[349] ?? 0);
  const accelMax = timeAxisMax([t3, t49]);
  const brakeMax = timeAxisMax([t4, t50, t349]);

  const speedSeries = useMemo(
    () => [{ id: "curve", color: cab, points: sampleSpeedCurve(mode, three, table) }],
    [cab, mode, three, table],
  );

  const speedHandles = useMemo(() => {
    if (mode === "three") {
      return [
        { id: "cv2", x: 1, y: three.vstart, color: cab, axis: "y" as const },
        { id: "cv6", x: MID_STEP, y: three.vmid, color: cab, axis: "y" as const },
        { id: "cv5", x: SPEED_STEPS, y: effectiveVhigh(three.vhigh), color: cab, axis: "y" as const },
      ];
    }
    return TABLE_CVS.map((cv, i) => ({
      id: `cv${cv}`,
      x: i + 1,
      y: table[i] ?? 0,
      color: cab,
      axis: "y" as const,
    }));
  }, [cab, mode, three, table]);

  const accelSeries = useMemo(
    () => [
      {
        id: "cab",
        color: cab,
        points: sampleMomentum(mode, three, table, t3, false),
      },
      {
        id: "hlu",
        color: hlu,
        dash: "8 5",
        points: sampleMomentum(mode, three, table, t49, false),
      },
    ],
    [cab, hlu, mode, three, table, t3, t49],
  );

  const brakeSeries = useMemo(
    () => [
      {
        id: "cab",
        color: cab,
        points: sampleMomentum(mode, three, table, t4, true),
      },
      {
        id: "hlu",
        color: hlu,
        dash: "8 5",
        points: sampleMomentum(mode, three, table, t50, true),
      },
      {
        id: "key",
        color: brake,
        dash: "3 4",
        points: sampleMomentum(mode, three, table, t349, true),
      },
    ],
    [cab, hlu, brake, mode, three, table, t4, t50, t349],
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
    if (TABLE_CVS.includes(cv)) {
      patch(cv, clampByte(v));
    }
  };

  const speedFields = mode === "three" ? [...THREE_POINT_CVS] : TABLE_CVS;

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
        <ToggleButton value="three">{t("speed.zimo.threePoint")}</ToggleButton>
        <ToggleButton value="table">{t("speed.zimo.table28")}</ToggleButton>
      </ToggleButtonGroup>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("speed.zimo.curveTitle")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={SPEED_STEPS}
          yMin={0}
          yMax={255}
          xLabel={t("speed.zimo.throttle")}
          yLabel={t("speed.zimo.internalSpeed")}
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
          {t("speed.zimo.accelTitle")}
        </Typography>
        <Legend
          items={[
            { color: cab, label: t("speed.zimo.cab") },
            { color: hlu, label: t("speed.zimo.hlu"), dash: true },
          ]}
        />
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: "0.9rem" }}>
          {t("speed.zimo.hluAccelNote")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={accelMax}
          yMin={0}
          yMax={255}
          xLabel={t("speed.zimo.time")}
          yLabel={t("speed.zimo.internalSpeed")}
          series={accelSeries}
          handles={[
            { id: "cv3", x: t3, y: vmax, color: cab, axis: "x" },
            { id: "cv49", x: t49, y: vmax, color: hlu, axis: "x" },
          ]}
          onMove={(id, x) => {
            if (id === "cv3") patch(3, secondsToCabCv(Math.max(0, x)));
            if (id === "cv49") patch(49, secondsToHluCv(Math.max(0, x)));
          }}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <CvValueField decoder={decoder} cv={3} value={values[3] ?? 0} onChange={(n) => patch(3, n)} />
          <CvValueField decoder={decoder} cv={49} value={values[49] ?? 0} onChange={(n) => patch(49, n)} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("speed.zimo.brakeTitle")}
        </Typography>
        <Legend
          items={[
            { color: cab, label: t("speed.zimo.cab") },
            { color: hlu, label: t("speed.zimo.hlu"), dash: true },
            { color: brake, label: t("speed.zimo.brakeKey"), dash: true },
          ]}
        />
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: "0.9rem" }}>
          {t("speed.zimo.hluBrakeNote")}
        </Typography>
        <DragLineChart
          xMin={0}
          xMax={brakeMax}
          yMin={0}
          yMax={255}
          xLabel={t("speed.zimo.time")}
          yLabel={t("speed.zimo.internalSpeed")}
          series={brakeSeries}
          handles={[
            { id: "cv4", x: t4, y: 0, color: cab, axis: "x" },
            { id: "cv50", x: t50, y: 0, color: hlu, axis: "x" },
            { id: "cv349", x: t349, y: 0, color: brake, axis: "x" },
          ]}
          onMove={(id, x) => {
            const s = Math.max(0, x);
            if (id === "cv4") patch(4, secondsToCabCv(s));
            if (id === "cv50") patch(50, secondsToHluCv(s));
            if (id === "cv349") patch(349, secondsToCabCv(s));
          }}
        />
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <CvValueField decoder={decoder} cv={4} value={values[4] ?? 0} onChange={(n) => patch(4, n)} />
          <CvValueField decoder={decoder} cv={50} value={values[50] ?? 0} onChange={(n) => patch(50, n)} />
          <CvValueField decoder={decoder} cv={349} value={values[349] ?? 0} onChange={(n) => patch(349, n)} />
          <CvValueField decoder={decoder} cv={309} value={values[309] ?? 0} onChange={(n) => patch(309, n)} />
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
