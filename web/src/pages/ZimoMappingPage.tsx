import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import type { DecoderProfile } from "../decoders/types";
import {
  CV_HIGH_BEAM_SPEED,
  CV_NO_LEFT_SHIFT,
  CV_PWM_DIM,
  DIM_SLOT_COUNT,
  F0_KEY,
  M_HIGH_BEAM,
  NMRA_KEYS,
  NMRA_OUTPUTS,
  NO_LEFT_SHIFT_VALUE,
  SWISS_GROUP_COUNT,
  allMappingReadCvs,
  decodeDim,
  decodeFKey,
  decodeMKey,
  decodeSwissOutput,
  dimCv,
  encodeDim,
  encodeFKey,
  encodeMKey,
  encodeSwissOutput,
  isNoLeftShift,
  nmraBitForOutput,
  nmraBitSet,
  nmraSetBit,
  swissGroupCvs,
  type NmraOutput,
} from "../features/zimoMapping";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

const DIM_FULL = encodeDim(31, false, false);

function outputLabel(t: (key: string, opts?: Record<string, string | number>) => string, output: NmraOutput): string {
  if (output === "front") return t("mapping.outFront");
  if (output === "rear") return t("mapping.outRear");
  return t("mapping.outFo", { n: Number(output.slice(2)) });
}

function swissWireLabel(t: (key: string, opts?: Record<string, string | number>) => string, output: number): string {
  if (output === 0) return t("mapping.outNone");
  if (output === 14) return t("mapping.outFront");
  if (output === 15) return t("mapping.outRear");
  return t("mapping.outFo", { n: output });
}

function keyLabel(t: (key: string, opts?: Record<string, string | number>) => string, key: number): string {
  if (key === 0) return t("mapping.unused");
  if (key === F0_KEY) return t("mapping.f0");
  return t("mapping.fn", { n: key });
}

function nmraKeyLabel(t: (key: string, opts?: Record<string, string | number>) => string, index: number): string {
  if (index === 0) return t("mapping.nmraKeyF0fwd");
  if (index === 1) return t("mapping.nmraKeyF0rev");
  return t("mapping.nmraKeyFn", { n: index - 1 });
}

export default function ZimoMappingPage({
  decoder,
  session,
}: {
  decoder: DecoderProfile;
  session: Session;
}) {
  const { t } = useTranslation();
  const registry = useCvRegistry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Record<number, boolean | undefined>>({});
  const [activeNmra, setActiveNmra] = useState(0);

  const values = useMemo(() => {
    const next: Record<number, number> = {};
    for (const cv of allMappingReadCvs()) {
      const item = decoder.cvs.find((c) => c.cv === cv);
      const fallback = cv >= 508 && cv <= 512 ? DIM_FULL : (item?.default ?? 0);
      next[cv] = registry.get(cv) ?? fallback;
    }
    return next;
    // Station table is the source of truth; diffs re-render after set/read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoder, registry.diffs]);

  const noLeftShift = isNoLeftShift(values[CV_NO_LEFT_SHIFT] ?? 0);
  const groups = useMemo(
    () => Array.from({ length: SWISS_GROUP_COUNT }, (_, i) => swissGroupCvs(i + 1)),
    [],
  );
  const highBeam = groups.some((g) => values[g.m] === M_HIGH_BEAM);

  const patch = (cv: number, value: number) => {
    registry.set(cv, value);
  };

  const readAll = async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      await programming.withReadOverlay(signal, async (inner) => {
        const { cvs } = await programming.cvRead({
          ...session,
          cvs: allMappingReadCvs(),
          signal: inner,
        });
        registry.rememberRead(cvs);
      });
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    void registry.ensureRead(allMappingReadCvs(), ac.signal).catch((err) => {
      if (!isCancelled(err)) setError(err);
    });
    return () => ac.abort();
    // Station / address only: track is transport, CVs stay in the registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.stationId, session.address]);

  return (
    <Stack spacing={3}>
      {error ? <ErrorAlert error={error} /> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">{t("mapping.nmraTitle")}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("mapping.nmraHint")}
        </Typography>
        <Tooltip title={t("mapping.anyKeyTooltip")}>
          <FormControlLabel
            sx={{ mb: 2 }}
            control={
              <Switch
                checked={noLeftShift}
                onChange={(_, on) => patch(CV_NO_LEFT_SHIFT, on ? NO_LEFT_SHIFT_VALUE : 0)}
              />
            }
            label={t("mapping.anyKey")}
          />
        </Tooltip>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("mapping.cvCaption", { cv: CV_NO_LEFT_SHIFT })}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {t("mapping.pickKey")}
        </Typography>
        <ToggleButtonGroup
          exclusive
          value={activeNmra}
          onChange={(_, k) => {
            if (k !== null) setActiveNmra(k);
          }}
          sx={{ flexWrap: "wrap", mb: 2 }}
        >
          {NMRA_KEYS.map((k) => (
            <ToggleButton key={k.cv} value={k.index} sx={{ minWidth: 56, minHeight: 48 }}>
              {nmraKeyLabel(t, k.index)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 3 }}>
          {NMRA_OUTPUTS.map((out) => {
            const key = NMRA_KEYS.find((k) => k.index === activeNmra) ?? NMRA_KEYS[0];
            const bit = nmraBitForOutput(noLeftShift, key.index, out);
            const on = bit !== null && nmraBitSet(values[key.cv] ?? 0, bit);
            return (
              <ToggleButton
                key={out}
                value={out}
                selected={on}
                disabled={bit === null}
                onChange={() => {
                  if (bit === null) return;
                  patch(key.cv, nmraSetBit(values[key.cv] ?? 0, bit, !on));
                }}
                sx={{ minWidth: 88, minHeight: 48 }}
              >
                {outputLabel(t, out)}
              </ToggleButton>
            );
          })}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("mapping.nmraPreview")}
        </Typography>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell />
                {NMRA_OUTPUTS.map((out) => (
                  <TableCell key={out} align="center" sx={{ px: 0.5, whiteSpace: "nowrap" }}>
                    <Tooltip title={outputLabel(t, out)}>
                      <span>{out === "front" || out === "rear" ? outputLabel(t, out) : out.slice(2)}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {NMRA_KEYS.map((key) => (
                <TableRow key={key.cv}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Typography variant="body2">{nmraKeyLabel(t, key.index)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("mapping.cvCaption", { cv: key.cv })}
                    </Typography>
                  </TableCell>
                  {NMRA_OUTPUTS.map((out) => {
                    const bit = nmraBitForOutput(noLeftShift, key.index, out);
                    const on = bit !== null && nmraBitSet(values[key.cv] ?? 0, bit);
                    return (
                      <TableCell key={out} align="center" sx={{ px: 0.25 }}>
                        <Tooltip title={outputLabel(t, out)}>
                          <span>
                            <Checkbox
                              size="small"
                              disabled={bit === null}
                              checked={on}
                              onChange={(_, next) => {
                                if (bit === null) return;
                                patch(key.cv, nmraSetBit(values[key.cv] ?? 0, bit, next));
                              }}
                              inputProps={{
                                "aria-label": `${nmraKeyLabel(t, key.index)} ${outputLabel(t, out)}`,
                              }}
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">{t("mapping.swissTitle")}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("mapping.swissHint")}
        </Typography>
        {groups.map((cvs, i) => {
          const n = i + 1;
          const f = decodeFKey(values[cvs.f] ?? 0);
          const m = decodeMKey(values[cvs.m] ?? 0);
          const expanded = open[n] ?? f.key !== 0;
          const titleKey = f.key === 0 ? t("mapping.unused") : keyLabel(t, f.key);
          return (
            <Accordion
              key={n}
              expanded={expanded}
              onChange={(_, next) => setOpen((s) => ({ ...s, [n]: next }))}
              disableGutters
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  {f.key === 0
                    ? t("mapping.sceneUnused", { n })
                    : t("mapping.sceneTitle", { n, key: titleKey })}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap">
                    <TipField title={t("mapping.fkeyTooltip")}>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>{t("mapping.fkey")}</InputLabel>
                        <Select
                          value={f.key}
                          label={t("mapping.fkey")}
                          onChange={(e) => patch(cvs.f, encodeFKey(Number(e.target.value), f.invert))}
                        >
                          <MenuItem value={0}>{t("mapping.unused")}</MenuItem>
                          <MenuItem value={F0_KEY}>{t("mapping.f0")}</MenuItem>
                          {Array.from({ length: 28 }, (_, k) => (
                            <MenuItem key={k + 1} value={k + 1}>
                              {t("mapping.fn", { n: k + 1 })}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TipField>
                    <Typography variant="caption" color="text.secondary" alignSelf="center">
                      {t("mapping.cvCaption", { cv: cvs.f })}
                    </Typography>
                    <Tooltip title={t("mapping.invertTooltip")}>
                      <FormControlLabel
                        disabled={f.key === 0}
                        control={
                          <Checkbox
                            checked={f.invert}
                            onChange={(_, on) => patch(cvs.f, encodeFKey(f.key, on))}
                          />
                        }
                        label={t("mapping.invert")}
                      />
                    </Tooltip>
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap">
                    <TipField title={t("mapping.mkeyTooltip")}>
                      <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>{t("mapping.mkey")}</InputLabel>
                        <Select
                          value={m.highBeam ? "hb" : String(m.key)}
                          label={t("mapping.mkey")}
                          onChange={(e) => {
                            const v = String(e.target.value);
                            if (v === "hb") {
                              patch(cvs.m, M_HIGH_BEAM);
                              return;
                            }
                            patch(
                              cvs.m,
                              encodeMKey({
                                highBeam: false,
                                key: Number(v),
                                requireBoth: m.requireBoth,
                                keepFwd: m.keepFwd,
                                keepRev: m.keepRev,
                              }),
                            );
                          }}
                        >
                          <MenuItem value="0">{t("mapping.mNone")}</MenuItem>
                          <MenuItem value="hb">{t("mapping.highBeam")}</MenuItem>
                          <MenuItem value={String(F0_KEY)}>{t("mapping.f0")}</MenuItem>
                          {Array.from({ length: 28 }, (_, k) => (
                            <MenuItem key={k + 1} value={String(k + 1)}>
                              {t("mapping.fn", { n: k + 1 })}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TipField>
                    <Typography variant="caption" color="text.secondary" alignSelf="center">
                      {t("mapping.cvCaption", { cv: cvs.m })}
                    </Typography>
                  </Stack>
                  {!m.highBeam && m.key > 0 ? (
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap">
                      <Tooltip title={t("mapping.requireBothTooltip")}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={m.requireBoth}
                              onChange={(_, on) => patch(cvs.m, encodeMKey({ ...m, requireBoth: on }))}
                            />
                          }
                          label={t("mapping.requireBoth")}
                        />
                      </Tooltip>
                      <Tooltip title={t("mapping.keepFwdTooltip")}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={m.keepFwd}
                              onChange={(_, on) => patch(cvs.m, encodeMKey({ ...m, keepFwd: on }))}
                            />
                          }
                          label={t("mapping.keepFwd")}
                        />
                      </Tooltip>
                      <Tooltip title={t("mapping.keepRevTooltip")}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={m.keepRev}
                              onChange={(_, on) => patch(cvs.m, encodeMKey({ ...m, keepRev: on }))}
                            />
                          }
                          label={t("mapping.keepRev")}
                        />
                      </Tooltip>
                    </Stack>
                  ) : null}
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    <SwissOutputs
                      t={t}
                      title={t("mapping.dirFwd")}
                      a1={cvs.a1f}
                      a2={cvs.a2f}
                      v1={values[cvs.a1f] ?? 0}
                      v2={values[cvs.a2f] ?? 0}
                      onChange={patch}
                    />
                    <SwissOutputs
                      t={t}
                      title={t("mapping.dirRev")}
                      a1={cvs.a1r}
                      a2={cvs.a2r}
                      v1={values[cvs.a1r] ?? 0}
                      v2={values[cvs.a2r] ?? 0}
                      onChange={patch}
                    />
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">{t("mapping.dimTitle")}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("mapping.dimHint")}
        </Typography>
        <Stack spacing={2}>
          {Array.from({ length: DIM_SLOT_COUNT }, (_, i) => {
            const slot = i + 1;
            const cv = dimCv(slot);
            const dim = decodeDim(values[cv] ?? DIM_FULL);
            return (
              <Box key={cv}>
                <Typography gutterBottom>
                  {t("mapping.dimLevel", { n: slot })} — {dim.brightness}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("mapping.cvCaption", { cv })}
                </Typography>
                <Slider
                  min={0}
                  max={31}
                  value={dim.brightness}
                  onChange={(_, v) => {
                    const n = Array.isArray(v) ? v[0] : v;
                    patch(cv, encodeDim(n, dim.flash, dim.flashInv));
                  }}
                  valueLabelDisplay="auto"
                />
              </Box>
            );
          })}
        </Stack>
        {highBeam ? (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h6">{t("mapping.highBeamTitle")}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t("mapping.highBeamHint")}
            </Typography>
            <Typography gutterBottom>
              {t("mapping.highBeamSpeed")} — {values[CV_HIGH_BEAM_SPEED] ?? 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("mapping.cvCaption", { cv: CV_HIGH_BEAM_SPEED })}
            </Typography>
            <Slider
              min={0}
              max={255}
              value={values[CV_HIGH_BEAM_SPEED] ?? 0}
              onChange={(_, v) => {
                const n = Array.isArray(v) ? v[0] : v;
                patch(CV_HIGH_BEAM_SPEED, n);
              }}
              valueLabelDisplay="auto"
            />
            <Tooltip title={t("mapping.pwmTooltip")}>
              <Box sx={{ mt: 2 }}>
                <Typography gutterBottom>
                  {t("mapping.pwm")} — {values[CV_PWM_DIM] ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("mapping.cvCaption", { cv: CV_PWM_DIM })}
                </Typography>
                <Slider
                  min={0}
                  max={255}
                  value={values[CV_PWM_DIM] ?? 0}
                  onChange={(_, v) => {
                    const n = Array.isArray(v) ? v[0] : v;
                    patch(CV_PWM_DIM, n);
                  }}
                  valueLabelDisplay="auto"
                />
              </Box>
            </Tooltip>
          </Box>
        ) : null}
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
          {t("mapping.read")}
        </Button>
      </Stack>
    </Stack>
  );
}

function TipField({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      <span>{children}</span>
    </Tooltip>
  );
}

function SwissOutputs({
  t,
  title,
  a1,
  a2,
  v1,
  v2,
  onChange,
}: {
  t: (key: string, opts?: Record<string, string | number>) => string;
  title: string;
  a1: number;
  a2: number;
  v1: number;
  v2: number;
  onChange: (cv: number, value: number) => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Stack spacing={1.5}>
        <SwissOutputRow t={t} label={t("mapping.out1")} cv={a1} value={v1} onChange={onChange} />
        <SwissOutputRow t={t} label={t("mapping.out2")} cv={a2} value={v2} onChange={onChange} />
      </Stack>
    </Paper>
  );
}

function SwissOutputRow({
  t,
  label,
  cv,
  value,
  onChange,
}: {
  t: (key: string, opts?: Record<string, string | number>) => string;
  label: string;
  cv: number;
  value: number;
  onChange: (cv: number, value: number) => void;
}) {
  const decoded = decodeSwissOutput(value);
  return (
    <Stack spacing={0.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <TipField title={t("mapping.outTooltip")}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{label}</InputLabel>
            <Select
              value={decoded.output}
              label={label}
              onChange={(e) => onChange(cv, encodeSwissOutput(Number(e.target.value), decoded.dimSlot))}
            >
              {Array.from({ length: 16 }, (_, n) => (
                <MenuItem key={n} value={n}>
                  {swissWireLabel(t, n)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </TipField>
        <TipField title={t("mapping.dimSlotTooltip")}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t("mapping.dimSlot")}</InputLabel>
            <Select
              value={decoded.dimSlot}
              label={t("mapping.dimSlot")}
              onChange={(e) => onChange(cv, encodeSwissOutput(decoded.output, Number(e.target.value)))}
            >
              <MenuItem value={0}>{t("mapping.dimNone")}</MenuItem>
              {Array.from({ length: DIM_SLOT_COUNT }, (_, i) => (
                <MenuItem key={i + 1} value={i + 1}>
                  {t("mapping.dimLevel", { n: i + 1 })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </TipField>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t("mapping.cvCaption", { cv })}
      </Typography>
    </Stack>
  );
}
