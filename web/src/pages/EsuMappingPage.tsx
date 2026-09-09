import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
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
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { useConfirm } from "../components/ConfirmDialog";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import { readQuery } from "../query";
import {
  discardIndexedCvTable,
  ensureIndexedCvScope,
  getIndexedCv,
  getIndexedCvSnapshot,
  indexedCvDiffs,
  rememberIndexedRead,
  setIndexedCv,
  subscribeIndexedCvTable,
} from "../cv/indexedTable";
import type { DecoderProfile } from "../decoders/types";
import {
  INDEX_CV31,
  INDEX_CV31_VALUE,
  INDEX_CV32,
  INDEXED_CV_START,
  SPEC1_BITS,
  applyBatches,
  clampBrightness,
  cycleCond,
  decodeDelay,
  encodeDelay,
  emptyRow,
  indexedKey,
  isRowEmpty,
  pagesLoaded,
  outputConfigPage,
  readRow,
  rowEntries,
  rowGroups,
  type CondState,
  type EsuMappingProfile,
  type EsuRow,
  type OutputConfigLayout,
} from "../features/esuMapping";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

const chipSx = { minWidth: 56, minHeight: 48 } as const;

type TFn = (key: string, opts?: Record<string, string | number>) => string;

function physicalLabel(t: TFn, id: string): string {
  if (id === "headlight") return t("mapping.esu.out.headlight");
  if (id === "rearlight") return t("mapping.esu.out.rearlight");
  if (id === "headlight2") return t("mapping.esu.out.headlight2");
  if (id === "rearlight2") return t("mapping.esu.out.rearlight2");
  if (id === "aux1c2") return t("mapping.esu.out.auxConfig2", { n: 1 });
  if (id === "aux2c2") return t("mapping.esu.out.auxConfig2", { n: 2 });
  if (id.startsWith("aux")) return t("mapping.esu.out.aux", { n: Number(id.slice(3)) });
  return id;
}

function condCaption(t: TFn, state: CondState, on: string, off: string): string {
  if (state === "on") return on;
  if (state === "off") return off;
  return t("mapping.esu.ignore");
}

function keyLabel(t: TFn, n: number): string {
  return n === 0 ? t("mapping.f0") : t("mapping.fn", { n });
}

function condColor(state: CondState): "primary" | "warning" | "standard" {
  if (state === "on") return "primary";
  if (state === "off") return "warning";
  return "standard";
}

export default function EsuMappingPage({
  decoder,
  profile,
  session,
}: {
  decoder: DecoderProfile;
  profile: EsuMappingProfile;
  session: Session;
}) {
  const { t } = useTranslation();
  const registry = useCvRegistry();
  const { confirm, dialog } = useConfirm();
  const [params] = useSearchParams();
  const station = readQuery(params).station;
  const [tab, setTab] = useState(0);
  const [groupIndex, setGroupIndex] = useState(0);
  const [open, setOpen] = useState<Record<number, boolean | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [applyFailed, setApplyFailed] = useState<string[]>([]);
  const applying = useRef(false);

  useLayoutEffect(() => {
    ensureIndexedCvScope({
      decoder: decoder.id,
      address: session.address,
      station,
    });
  }, [decoder.id, session.address, station]);

  const snap = useSyncExternalStore(subscribeIndexedCvTable, getIndexedCvSnapshot, getIndexedCvSnapshot);
  const diffs = useMemo(() => indexedCvDiffs(snap), [snap]);

  const get = (cv32: number, cv: number) => getIndexedCv(indexedKey(cv32, cv));

  const groups = useMemo(() => rowGroups(profile), [profile]);
  const group = groups[Math.min(groupIndex, groups.length - 1)] ?? groups[0];
  const outputsPage = useMemo(() => outputConfigPage(profile), [profile]);

  const patchRow = (row: number, next: EsuRow) => {
    for (const e of rowEntries(profile, row, next)) {
      setIndexedCv(indexedKey(e.cv32, e.cv), e.value);
    }
  };

  const readPages = async (
    pages: { cv32: number; cvs: number[] }[],
    signal?: AbortSignal,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await programming.withOverlay({ mode: "read" }, async (inner) => {
        for (const page of pages) {
          if (inner.aborted) return;
          await programming.cvWrite({
            ...session,
            cvs: [
              { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
              { cv: INDEX_CV32, value: page.cv32 },
            ],
            signal: inner,
          });
          registry.rememberRead([
            { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
            { cv: INDEX_CV32, value: page.cv32 },
          ]);
          const { cvs } = await programming.cvRead({
            ...session,
            cvs: page.cvs,
            signal: inner,
            liveApply: false,
          });
          rememberIndexedRead(
            cvs.map((e) => ({ key: indexedKey(page.cv32, e.cv), value: e.value })),
          );
        }
      }, signal);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const pages = tab === 0 ? group?.pages : [outputsPage];
    if (!pages || pagesLoaded(pages, get)) return;
    const ac = new AbortController();
    void readPages(pages, ac.signal);
    return () => ac.abort();
    // Station / address / tab / group: track is transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.stationId, session.address, tab, groupIndex, profile.id]);

  const apply = async () => {
    if (diffs.length === 0 || applying.current) return;
    const ok = await confirm({
      title: t("mapping.esu.confirmApplyTitle"),
      body: t("mapping.esu.confirmApplyBody", { count: diffs.length }),
    });
    if (!ok) return;
    applying.current = true;
    setBusy(true);
    setError(null);
    setApplyFailed([]);
    try {
      const batches = applyBatches(diffs);
      const failedKeys: string[] = [];
      await programming.withOverlay({ mode: "write" }, async (signal) => {
        for (const batch of batches) {
          const written = await programming.cvWrite({ ...session, cvs: batch.cvs, signal });
          const failed = new Set(written.errors);
          const confirmed = batch.cvs
            .filter((e) => e.cv >= INDEXED_CV_START && !failed.has(e.cv))
            .map((e) => ({ key: indexedKey(batch.cv32, e.cv), value: e.value }));
          rememberIndexedRead(confirmed);
          if (!failed.has(INDEX_CV31) && !failed.has(INDEX_CV32)) {
            registry.rememberRead([
              { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
              { cv: INDEX_CV32, value: batch.cv32 },
            ]);
          }
          for (const e of batch.cvs) {
            if (e.cv >= INDEXED_CV_START && failed.has(e.cv)) {
              failedKeys.push(indexedKey(batch.cv32, e.cv));
            }
          }
        }
      });
      setApplyFailed(failedKeys);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: t("mapping.esu.confirmDiscardTitle"),
      body: t("mapping.esu.confirmDiscardBody"),
      danger: true,
    });
    if (ok) discardIndexedCvTable();
  };

  const currentPages = tab === 0 ? group?.pages ?? [] : [outputsPage];

  return (
    <Stack spacing={3}>
      {dialog}
      {error ? <ErrorAlert error={error} /> : null}
      {applyFailed.length > 0 ? (
        <Alert severity="warning">{t("mapping.esu.applyPartial", { cvs: applyFailed.join(", ") })}</Alert>
      ) : null}

      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} variant="fullWidth">
        <Tab label={t("mapping.esu.tabRows")} sx={{ minHeight: 48 }} />
        <Tab label={t("mapping.esu.tabOutputs")} sx={{ minHeight: 48 }} />
      </Tabs>

      {tab === 0 && group ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("mapping.esu.rowsHint")}
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={groupIndex}
            onChange={(_, v: number | null) => {
              if (v !== null) setGroupIndex(v);
            }}
            sx={{ flexWrap: "wrap", mb: 2 }}
          >
            {groups.map((g, i) => (
              <ToggleButton key={g.firstRow} value={i} sx={chipSx}>
                {t("mapping.esu.groupRows", { from: g.firstRow, to: g.lastRow })}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {pagesLoaded(group.pages, get) ? (
            Array.from({ length: group.lastRow - group.firstRow + 1 }, (_, i) => {
              const row = group.firstRow + i;
              const decoded = readRow(profile, row, get) ?? emptyRow(profile);
              const empty = isRowEmpty(decoded);
              const expanded = open[row] ?? !empty;
              return (
                <Accordion
                  key={row}
                  expanded={expanded}
                  onChange={(_, next) => setOpen((s) => ({ ...s, [row]: next }))}
                  disableGutters
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
                    <Typography>
                      {empty
                        ? t("mapping.esu.rowEmpty", { n: row })
                        : t("mapping.esu.rowTitle", { n: row })}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <RowEditor t={t} profile={profile} row={decoded} onChange={(next) => patchRow(row, next)} />
                  </AccordionDetails>
                </Accordion>
              );
            })
          ) : (
            <Typography color="text.secondary">{t("mapping.esu.notReadYet")}</Typography>
          )}
        </Paper>
      ) : null}

      {tab === 1 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("mapping.esu.outputsHint")}
          </Typography>
          {pagesLoaded([outputsPage], get) ? (
            <Stack spacing={2}>
              {profile.outputConfigs.map((out) => (
                <OutputEditor
                  key={out.id}
                  t={t}
                  profile={profile}
                  layout={out}
                  get={get}
                  onPatch={(cv, value) => setIndexedCv(indexedKey(0, cv), value)}
                />
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">{t("mapping.esu.notReadYet")}</Typography>
          )}
        </Paper>
      ) : null}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap">
        <Button variant="outlined" disabled={busy} onClick={() => void readPages(currentPages)}>
          {t("mapping.read")}
        </Button>
        <Button variant="contained" disabled={busy || diffs.length === 0} onClick={() => void apply()}>
          {t("mapping.esu.apply")}
        </Button>
        <Button variant="outlined" disabled={busy || diffs.length === 0} onClick={() => void discard()}>
          {t("mapping.esu.discard")}
        </Button>
        {diffs.length > 0 ? (
          <Typography color="text.secondary" alignSelf="center">
            {t("mapping.esu.dirtyCount", { count: diffs.length })}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}

function CondChip({
  t,
  label,
  state,
  idleLabel,
  onCycle,
}: {
  t: TFn;
  label: string;
  state: CondState;
  idleLabel?: string;
  onCycle: () => void;
}) {
  const text =
    state === "ignore"
      ? (idleLabel ?? label)
      : idleLabel
        ? label
        : `${label} ${state === "off" ? t("mapping.esu.keyOff") : t("mapping.esu.keyOn")}`;
  return (
    <ToggleButton
      value={idleLabel ?? label}
      selected={state !== "ignore"}
      color={condColor(state)}
      onClick={onCycle}
      sx={chipSx}
    >
      {text}
    </ToggleButton>
  );
}

function RowEditor({
  t,
  profile,
  row,
  onChange,
}: {
  t: TFn;
  profile: EsuMappingProfile;
  row: EsuRow;
  onChange: (next: EsuRow) => void;
}) {
  const cond = row.conditions;
  const patchCond = (next: Partial<EsuRow["conditions"]>) =>
    onChange({ ...row, conditions: { ...cond, ...next } });

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("mapping.esu.conditions")}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <CondChip
          t={t}
          label={condCaption(t, cond.moving, t("mapping.esu.drive"), t("mapping.esu.stop"))}
          state={cond.moving}
          idleLabel={t("mapping.esu.moving")}
          onCycle={() => patchCond({ moving: cycleCond(cond.moving) })}
        />
        <CondChip
          t={t}
          label={condCaption(t, cond.direction, t("mapping.dirFwd"), t("mapping.dirRev"))}
          state={cond.direction}
          idleLabel={t("mapping.esu.direction")}
          onCycle={() => patchCond({ direction: cycleCond(cond.direction) })}
        />
        {Array.from({ length: profile.maxKey + 1 }, (_, n) => (
          <CondChip
            t={t}
            key={n}
            label={keyLabel(t, n)}
            state={cond.keys[n] ?? "ignore"}
            onCycle={() => {
              const keys = [...cond.keys];
              keys[n] = cycleCond(keys[n] ?? "ignore");
              patchCond({ keys });
            }}
          />
        ))}
        <CondChip
          t={t}
          label={t("mapping.esu.wheel")}
          state={cond.wheelSensor}
          onCycle={() => patchCond({ wheelSensor: cycleCond(cond.wheelSensor) })}
        />
        {cond.sensors.map((s, i) => (
          <CondChip
            t={t}
            key={`s${i}`}
            label={t("mapping.esu.sensor", { n: i + 1 })}
            state={s}
            onCycle={() => {
              const sensors: [CondState, CondState, CondState, CondState] = [
                cond.sensors[0],
                cond.sensors[1],
                cond.sensors[2],
                cond.sensors[3],
              ];
              sensors[i] = cycleCond(s);
              patchCond({ sensors });
            }}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2">{t("mapping.esu.physical")}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {profile.physical.map((p) => {
          const on = row.physical.includes(p.id);
          return (
            <ToggleButton
              key={p.id}
              value={p.id}
              selected={on}
              onClick={() => {
                const physical = on
                  ? row.physical.filter((id) => id !== p.id)
                  : [...row.physical, p.id];
                onChange({ ...row, physical });
              }}
              sx={chipSx}
            >
              {physicalLabel(t, p.id)}
            </ToggleButton>
          );
        })}
      </Stack>

      <Typography variant="subtitle2">{t("mapping.esu.logicTitle")}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {profile.logicFns.map((fn) => (
          <FormControlLabel
            key={fn.id}
            sx={{ minHeight: 48, mr: 1 }}
            control={
              <Checkbox
                checked={row.logic.includes(fn.id)}
                onChange={(_, on) => {
                  const logic = on ? [...row.logic, fn.id] : row.logic.filter((id) => id !== fn.id);
                  onChange({ ...row, logic });
                }}
              />
            }
            label={t(`mapping.esu.logic.${fn.id}`)}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2">{t("mapping.esu.sound")}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {Array.from({ length: profile.slotCount }, (_, i) => {
          const n = i + 1;
          const on = row.slots.includes(n);
          return (
            <ToggleButton
              key={n}
              value={n}
              selected={on}
              onClick={() => {
                const slots = on ? row.slots.filter((s) => s !== n) : [...row.slots, n];
                onChange({ ...row, slots });
              }}
              sx={chipSx}
            >
              {t("mapping.esu.slot", { n })}
            </ToggleButton>
          );
        })}
      </Stack>
    </Stack>
  );
}

function OutputEditor({
  t,
  profile,
  layout,
  get,
  onPatch,
}: {
  t: TFn;
  profile: EsuMappingProfile;
  layout: OutputConfigLayout;
  get: (cv32: number, cv: number) => number | undefined;
  onPatch: (cv: number, value: number) => void;
}) {
  const mode = get(0, layout.modeCv) ?? 0;
  const delay = decodeDelay(get(0, layout.delayCv) ?? 0);
  const autoOff = get(0, layout.autoOffCv) ?? 0;
  const brightness = get(0, layout.brightnessCv) ?? 0;
  const spec1 = get(0, layout.spec1Cv) ?? 0;
  const spec2 = get(0, layout.spec2Cv) ?? 0;
  const spec3 = layout.spec3Cv !== undefined ? (get(0, layout.spec3Cv) ?? 0) : undefined;
  const knownMode = profile.modes.some((m) => m.value === mode);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {physicalLabel(t, layout.id)}
      </Typography>
      <Stack spacing={1.5}>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>{t("mapping.esu.modeLabel")}</InputLabel>
          <Select
            value={mode}
            label={t("mapping.esu.modeLabel")}
            onChange={(e) => onPatch(layout.modeCv, Number(e.target.value))}
          >
            <MenuItem value={0}>{t("mapping.esu.modeNone")}</MenuItem>
            {profile.modes.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {t(`mapping.esu.mode.${m.id}`)}
              </MenuItem>
            ))}
            {!knownMode && mode > 0 ? (
              <MenuItem value={mode}>{t("mapping.esu.modeUnknown", { n: mode })}</MenuItem>
            ) : null}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          {t("mapping.cvCaption", { cv: layout.modeCv })}
        </Typography>
        <Box>
          <Typography variant="body2">
            {t("mapping.esu.brightness")} — {brightness}
          </Typography>
          <Slider
            min={0}
            max={31}
            value={brightness}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              onPatch(layout.brightnessCv, clampBrightness(n));
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        <Box>
          <Typography variant="body2">
            {t("mapping.esu.delayOn")} — {delay.on}
          </Typography>
          <Slider
            min={0}
            max={15}
            value={delay.on}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              onPatch(layout.delayCv, encodeDelay(n, delay.off));
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        <Box>
          <Typography variant="body2">
            {t("mapping.esu.delayOff")} — {delay.off}
          </Typography>
          <Slider
            min={0}
            max={15}
            value={delay.off}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              onPatch(layout.delayCv, encodeDelay(delay.on, n));
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        <Box>
          <Typography variant="body2">
            {t("mapping.esu.autoOff")} — {autoOff}
          </Typography>
          <Slider
            min={0}
            max={255}
            value={autoOff}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              onPatch(layout.autoOffCv, n);
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {SPEC1_BITS.map((bit) => (
            <FormControlLabel
              key={bit.id}
              sx={{ minHeight: 48 }}
              control={
                <Checkbox
                  checked={((spec1 >> bit.bit) & 1) === 1}
                  onChange={(_, on) => {
                    const mask = 1 << bit.bit;
                    onPatch(layout.spec1Cv, on ? spec1 | mask : spec1 & ~mask);
                  }}
                />
              }
              label={t(`mapping.esu.spec1.${bit.id}`)}
            />
          ))}
        </Stack>
        <Box>
          <Typography variant="body2">
            {t("mapping.esu.spec2")} — {spec2}
          </Typography>
          <Slider
            min={0}
            max={255}
            value={spec2}
            onChange={(_, v) => {
              const n = Array.isArray(v) ? v[0] : v;
              onPatch(layout.spec2Cv, n);
            }}
            valueLabelDisplay="auto"
          />
        </Box>
        {spec3 !== undefined && layout.spec3Cv !== undefined ? (
          <Box>
            <Typography variant="body2">
              {t("mapping.esu.spec3")} — {spec3}
            </Typography>
            <Slider
              min={0}
              max={255}
              value={spec3}
              onChange={(_, v) => {
                const n = Array.isArray(v) ? v[0] : v;
                onPatch(layout.spec3Cv!, n);
              }}
              valueLabelDisplay="auto"
            />
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
