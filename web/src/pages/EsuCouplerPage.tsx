import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { useConfirm } from "../components/ConfirmDialog";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import {
  getIndexedCv,
  getIndexedCvSnapshot,
  rememberIndexedRead,
  setIndexedCv,
  subscribeIndexedCvTable,
} from "../cv/indexedTable";
import type { DecoderProfile } from "../decoders/types";
import {
  couplerFState,
  couplerOutputCvs,
  esuCouplerModes,
  esuTimeSeconds,
  ESU_WALTZ_CVS,
  isCouplerMode,
  pagesToAssignCouplerF,
  pagesToShowCouplerF,
  planCouplerFAssign,
  removingShorterThanPush,
  servoCouplerHint,
  type CouplerFState,
} from "../features/esuCoupler";
import {
  clampBrightness,
  ESU_SIDE_ID,
  ESU_SIDE_TABLE,
  INDEX_CV31,
  INDEX_CV31_VALUE,
  INDEX_CV32,
  indexedKey,
  keepsEsuSideTable,
  pagesLoaded,
  rowEntries,
  unreadPages,
  type EsuMappingProfile,
  type IndexPage,
  type OutputConfigLayout,
} from "../features/esuMapping";

interface Session {
  stationId?: number;
  address: number;
  track: "prog" | "pom";
}

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

function keyLabel(t: TFn, n: number): string {
  return n === 0 ? t("mapping.f0") : t("mapping.fn", { n });
}

function formatKeys(t: TFn, keys: number[]): string {
  return keys.map((n) => keyLabel(t, n)).join(", ");
}

export default function EsuCouplerPage({
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fNote, setFNote] = useState<string | null>(null);
  const [mappingTick, setMappingTick] = useState(0);
  const [openOutput, setOpenOutput] = useState<Record<string, boolean | undefined>>({});
  const leaveConfirming = useRef(false);

  useLayoutEffect(() => {
    registry.registerSideTable(ESU_SIDE_TABLE);
    return () => registry.unregisterSideTable(ESU_SIDE_ID);
  }, [registry.registerSideTable, registry.unregisterSideTable]);

  const snap = useSyncExternalStore(subscribeIndexedCvTable, getIndexedCvSnapshot, getIndexedCvSnapshot);
  const sideDirty = registry.sideHasPending(ESU_SIDE_ID);
  const modes = useMemo(() => esuCouplerModes(profile), [profile]);
  const indexedCvs = useMemo(() => couplerOutputCvs(profile), [profile]);
  const outputsPage = useMemo(() => ({ cv32: 0, cvs: indexedCvs }), [indexedCvs]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      sideDirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !keepsEsuSideTable(nextLocation.pathname),
  );

  useEffect(() => {
    if (blocker.state !== "blocked" || leaveConfirming.current) return;
    leaveConfirming.current = true;
    void (async () => {
      const ok = await confirm({
        title: t("coupler.confirmLeaveTitle"),
        body: t("coupler.confirmLeaveBody"),
        danger: true,
      });
      if (ok) {
        registry.discardSide(ESU_SIDE_ID);
        blocker.proceed();
        return;
      }
      leaveConfirming.current = false;
      blocker.reset();
    })();
  }, [blocker, confirm, registry.discardSide, t]);

  const getIndexed = (cv: number) => {
    void snap;
    return getIndexedCv(indexedKey(0, cv));
  };

  const getMap = (cv32: number, cv: number) => {
    void snap;
    return getIndexedCv(indexedKey(cv32, cv));
  };

  const speed = registry.get(246);
  const removing = registry.get(247);
  const pushing = registry.get(248);
  const waltzKnown = speed !== undefined && removing !== undefined && pushing !== undefined;
  const outputsReady = pagesLoaded([outputsPage], (cv32, cv) => getIndexedCv(indexedKey(cv32, cv)));

  const couplerOutputIds = useMemo(() => {
    if (!outputsReady) return [];
    return profile.outputConfigs
      .filter((out) => isCouplerMode(getIndexed(out.modeCv) ?? 0, modes))
      .map((out) => out.id);
    // getIndexed reads snap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputsReady, profile, modes, snap]);

  const readIndexedPages = useCallback(
    async (pages: IndexPage[], signal?: AbortSignal): Promise<boolean> => {
      if (pages.length === 0) return true;
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
            rememberIndexedRead(cvs.map((e) => ({ key: indexedKey(page.cv32, e.cv), value: e.value })));
          }
        }, signal);
        return !signal?.aborted;
      } catch (err) {
        if (!isCancelled(err)) setError(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [registry.rememberRead, session],
  );

  const readAll = async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      await programming.withOverlay({ mode: "read" }, async (inner) => {
        if (inner.aborted) return;
        const { cvs } = await programming.cvRead({
          ...session,
          cvs: [...ESU_WALTZ_CVS],
          signal: inner,
        });
        registry.rememberRead(cvs);
        if (inner.aborted) return;
        await programming.cvWrite({
          ...session,
          cvs: [
            { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
            { cv: INDEX_CV32, value: 0 },
          ],
          signal: inner,
        });
        registry.rememberRead([
          { cv: INDEX_CV31, value: INDEX_CV31_VALUE },
          { cv: INDEX_CV32, value: 0 },
        ]);
        const { cvs: indexed } = await programming.cvRead({
          ...session,
          cvs: outputsPage.cvs,
          signal: inner,
          liveApply: false,
        });
        rememberIndexedRead(indexed.map((e) => ({ key: indexedKey(0, e.cv), value: e.value })));
      }, signal);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (waltzKnown && outputsReady) return;
    const ac = new AbortController();
    void readAll(ac.signal);
    return () => ac.abort();
    // Station / address / profile: track is transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.stationId, session.address, profile.id]);

  const couplerKey = couplerOutputIds.join(",");

  useEffect(() => {
    if (!outputsReady || couplerOutputIds.length === 0) return;
    const pages = unreadPages(pagesToShowCouplerF(profile, couplerOutputIds, getMap), getMap);
    if (pages.length === 0) return;
    const ac = new AbortController();
    void readIndexedPages(pages, ac.signal).then((ok) => {
      if (ok && !ac.signal.aborted) setMappingTick((n) => n + 1);
    });
    return () => ac.abort();
    // mappingTick: after physical CVs, load matching full rows. Do not depend on snap
    // (each remembered CV would abort the in-flight page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputsReady, couplerKey, mappingTick, profile.id, session.stationId, session.address]);

  const setWaltz = (cv: number, value: number) => {
    registry.set(cv, Math.min(255, Math.max(0, Math.round(value))));
  };

  const assignF = async (outputId: string, fKey: number) => {
    setFNote(null);
    for (let i = 0; i < 8; i++) {
      const gap = unreadPages(pagesToAssignCouplerF(profile, outputId, getMap), getMap);
      if (gap.length > 0) {
        const ok = await readIndexedPages(gap);
        if (!ok) return;
        continue;
      }
      const planned = planCouplerFAssign(profile, outputId, fKey, getMap);
      if (planned.kind === "unread") return;
      if (planned.kind === "complex") return;
      if (planned.kind === "no-empty") {
        setFNote(t("coupler.esu.functionKeyNoEmpty"));
        return;
      }
      if (planned.overwriteKeys.length > 0) {
        const ok = await confirm({
          title: t("coupler.esu.functionKeyOverwriteTitle"),
          body: t("coupler.esu.functionKeyOverwrite", {
            keys: formatKeys(t, planned.overwriteKeys),
            next: fKey,
          }),
        });
        if (!ok) return;
      }
      for (const e of rowEntries(profile, planned.row, planned.next)) {
        setIndexedCv(indexedKey(e.cv32, e.cv), e.value);
      }
      return;
    }
  };

  return (
    <Stack spacing={3}>
      {dialog}
      {error ? <ErrorAlert error={error} /> : null}
      {fNote ? <Alert severity="warning">{fNote}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("coupler.esu.waltzTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("coupler.esu.waltzHint")}
        </Typography>
        {waltzKnown ? (
          <Stack spacing={2}>
            <FormControlLabel
              sx={{ minHeight: 48 }}
              control={
                <Switch
                  checked={(speed ?? 0) > 0}
                  onChange={(_, on) => setWaltz(246, on ? Math.max(speed ?? 0, 20) : 0)}
                />
              }
              label={t("coupler.esu.waltzOn")}
            />
            <Box>
              <Typography>
                {t("coupler.esu.speed")} — {speed}
              </Typography>
              <Slider
                min={0}
                max={255}
                value={speed ?? 0}
                onChange={(_, v) => setWaltz(246, Array.isArray(v) ? v[0] : v)}
                valueLabelDisplay="auto"
              />
            </Box>
            <Box>
              <Typography>
                {t("coupler.esu.push")} — {t("coupler.esu.seconds", { value: esuTimeSeconds(pushing ?? 0).toFixed(2) })}
              </Typography>
              <Slider
                min={0}
                max={255}
                value={pushing ?? 0}
                onChange={(_, v) => setWaltz(248, Array.isArray(v) ? v[0] : v)}
                valueLabelDisplay="auto"
              />
            </Box>
            <Box>
              <Typography>
                {t("coupler.esu.remove")} — {t("coupler.esu.seconds", { value: esuTimeSeconds(removing ?? 0).toFixed(2) })}
              </Typography>
              <Slider
                min={0}
                max={255}
                value={removing ?? 0}
                onChange={(_, v) => setWaltz(247, Array.isArray(v) ? v[0] : v)}
                valueLabelDisplay="auto"
              />
            </Box>
            {removingShorterThanPush(removing ?? 0, pushing ?? 0) ? (
              <Alert severity="warning">{t("coupler.esu.removeShorter")}</Alert>
            ) : null}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("coupler.esu.outputsTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("coupler.esu.outputsHint")}
        </Typography>
        {outputsReady ? (
          <Stack sx={{ gap: 1 }}>
            {profile.outputConfigs.map((out) => (
              <OutputRow
                key={out.id}
                t={t}
                profile={profile}
                layout={out}
                modes={modes}
                mode={getIndexed(out.modeCv) ?? 0}
                brightness={getIndexed(out.brightnessCv) ?? 0}
                fState={couplerFState(profile, out.id, getMap)}
                fBusy={busy}
                expanded={openOutput[out.id] ?? isCouplerMode(getIndexed(out.modeCv) ?? 0, modes)}
                onToggle={(next) => setOpenOutput((s) => ({ ...s, [out.id]: next }))}
                onMode={(value) => setIndexedCv(indexedKey(0, out.modeCv), value)}
                onBrightness={(value) => setIndexedCv(indexedKey(0, out.brightnessCv), clampBrightness(value))}
                onFKey={(fKey) => void assignF(out.id, fKey)}
              />
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
        )}
      </Paper>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
          {t("coupler.read")}
        </Button>
      </Stack>
    </Stack>
  );
}

function OutputRow({
  t,
  profile,
  layout,
  modes,
  mode,
  brightness,
  fState,
  fBusy,
  expanded,
  onToggle,
  onMode,
  onBrightness,
  onFKey,
}: {
  t: TFn;
  profile: EsuMappingProfile;
  layout: OutputConfigLayout;
  modes: { value: number; id: string }[];
  mode: number;
  brightness: number;
  fState: CouplerFState;
  fBusy: boolean;
  expanded: boolean;
  onToggle: (next: boolean) => void;
  onMode: (value: number) => void;
  onBrightness: (value: number) => void;
  onFKey: (fKey: number) => void;
}) {
  const coupler = isCouplerMode(mode, modes);
  const selectValue = coupler ? mode : 0;
  const fValue = fState.kind === "simple" && fState.keys.length === 1 ? String(fState.keys[0]) : "";
  return (
    <Accordion expanded={expanded} onChange={(_, next) => onToggle(next)} disableGutters variant="outlined">
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
        <Typography sx={{ fontWeight: 700 }}>{physicalLabel(t, layout.id)}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <FormControl fullWidth>
            <InputLabel>{t("coupler.esu.type")}</InputLabel>
            <Select
              value={selectValue}
              label={t("coupler.esu.type")}
              onChange={(e) => onMode(Number(e.target.value))}
            >
              <MenuItem value={0}>{t("coupler.esu.typeNone")}</MenuItem>
              {modes.map((m) => (
                <MenuItem key={m.value} value={m.value}>
                  {t(`mapping.esu.mode.${m.id}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {coupler ? (
            <FormControl fullWidth>
              <InputLabel>{t("coupler.esu.functionKey")}</InputLabel>
              <Select
                value={fValue}
                label={t("coupler.esu.functionKey")}
                disabled={fBusy || fState.kind === "unread" || fState.kind === "complex"}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") return;
                  onFKey(Number(raw));
                }}
              >
                <MenuItem value="">{t("coupler.esu.functionKeyNone")}</MenuItem>
                {Array.from({ length: profile.maxKey + 1 }, (_, n) => (
                  <MenuItem key={n} value={String(n)}>
                    {keyLabel(t, n)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          {coupler && fState.kind === "unread" ? (
            <Typography color="text.secondary">{t("coupler.notReadYet")}</Typography>
          ) : null}
          {coupler && fState.kind === "complex" ? (
            <Alert severity="info">
              {t("coupler.esu.functionKeyComplex", { keys: formatKeys(t, fState.keys) || "—" })}
            </Alert>
          ) : null}
          {coupler ? (
            <Box>
              <Typography>
                {t("coupler.esu.strength")} — {brightness}
              </Typography>
              <Slider
                min={0}
                max={31}
                value={brightness}
                onChange={(_, v) => onBrightness(Array.isArray(v) ? v[0] : v)}
                valueLabelDisplay="auto"
              />
            </Box>
          ) : null}
          {mode === 31 && servoCouplerHint(profile, layout) ? (
            <Typography color="text.secondary">{t("coupler.esu.servoHint")}</Typography>
          ) : null}
          {mode === 31 && profile.id === "loksound-v4" && !servoCouplerHint(profile, layout) ? (
            <Typography color="text.secondary">{t("coupler.esu.servoAuxHint")}</Typography>
          ) : null}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
