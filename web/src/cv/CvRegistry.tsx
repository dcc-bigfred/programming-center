import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError, isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import { getDecoder } from "../decoders/registry";
import { sortCvDiffsForWrite } from "../decoders/types";
import { ADDRESS_CVS, decodeAddress, decodeAddressFromCvs } from "../features/dccAddress";
import { addressNumber, readQuery, stationNumber, withQuery } from "../query";
import { mainCvStore } from "./table";
import {
  formatCvDiffs,
  getCv,
  rememberRead,
  retargetCvScopeAddress,
  setCv,
  setCvBits,
  setCvs,
  type CvDiff,
} from "./table";
import type { ChangeSection, SideTable } from "./store";

type AnySideTable = SideTable<string | number>;

interface CvRegistryValue {
  get: (cv: number) => number | undefined;
  /** Main-table diffs only. Changelists stay numbered-CV JSON. */
  diffs: CvDiff[];
  /** Main plus every *registered* side. Unregistered sides are invisible here. */
  sections: ChangeSection[];
  hasPending: boolean;
  set: (cv: number, value: number) => void;
  setMany: (entries: CvDiff[]) => void;
  setBits: (cv: number, andMask: number, orMask: number) => void;
  rememberRead: (entries: CvDiff[]) => void;
  ensureRead: (cvs: number[], signal?: AbortSignal) => Promise<void>;
  /** Zmiany → Odrzuć: main and every active side. */
  discard: () => void;
  /** Leave a page-scoped table (e.g. /mapping). Main diffs stay. */
  discardSide: (id: string) => void;
  sideHasPending: (id: string) => boolean;
  registerSideTable: (def: AnySideTable) => void;
  unregisterSideTable: (id: string) => void;
  sideTable: (id: string) => AnySideTable["store"] | undefined;
  apply: () => Promise<void>;
  applyBusy: boolean;
  applyError: unknown;
  applyFailed: string[];
  addressError: unknown;
  formatDiffs: (diffs: CvDiff[]) => string;
  formatSections: (sections: ChangeSection[]) => string;
}

const CvRegistryContext = createContext<CvRegistryValue | null>(null);

const MAIN_GROUP_KEY = "changes.mainGroup";

export function CvRegistryProvider({ children }: { children: ReactNode }) {
  const { config, token, ready } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const snap = useSyncExternalStore(mainCvStore.subscribe, mainCvStore.getSnapshot, mainCvStore.getSnapshot);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<unknown>(null);
  const [applyFailed, setApplyFailed] = useState<string[]>([]);
  const [addressError, setAddressError] = useState<unknown>(null);
  const applying = useRef(false);
  const sidesRef = useRef(new Map<string, AnySideTable>());
  const [sideEpoch, setSideEpoch] = useState(0);
  const [sideTick, setSideTick] = useState(0);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  const bumpSides = useCallback(() => setSideEpoch((n) => n + 1), []);

  useEffect(() => {
    const unsubs = [...sidesRef.current.values()].map((side) =>
      side.store.subscribe(() => setSideTick((n) => n + 1)),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [sideEpoch]);

  useLayoutEffect(() => {
    const scope = {
      decoder: query.decoder,
      address: session.address,
      station: query.station,
    };
    mainCvStore.ensureScope(scope);
    // Scope is per locomotive. Changing decoder/station/address reloads every
    // *registered* side too so mapping diffs from loco A never mix with loco B.
    // Leaving /mapping does not run this — it only unregisters, and cache stays.
    for (const side of sidesRef.current.values()) {
      side.store.ensureScope(scope);
    }
  }, [query.decoder, query.station, session.address, sideEpoch]);

  useEffect(() => {
    if (!ready || !config?.enabled) return;
    if (config.loginRequired && !token) return;
    const decoder = getDecoder(query.decoder);
    if (!decoder?.features.includes("address") || session.address !== 0) {
      setAddressError(null);
      return;
    }
    setAddressError(null);
    const longBit = decoder.longAddressBit ?? 5;
    if (ADDRESS_CVS.every((cv) => getCv(cv) !== undefined)) {
      const cached = decodeAddressFromCvs(
        ADDRESS_CVS.map((cv) => ({ cv, value: getCv(cv) as number })),
        longBit,
      );
      if (cached && cached.address >= 1 && cached.address !== session.address) {
        retargetCvScopeAddress(cached.address);
        setParams(withQuery(params, { address: String(cached.address) }), { replace: true });
      }
      return;
    }
    const ac = new AbortController();
    void (async () => {
      try {
        const { cvs } = await programming.cvRead({
          stationId: session.stationId,
          address: session.address,
          track: "prog",
          cvs: [...ADDRESS_CVS],
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        rememberRead(cvs);
        const got = decodeAddressFromCvs(cvs, longBit);
        if (!got || got.address < 1) {
          throw new ApiError(0, "address_read_failed");
        }
        if (got.address !== session.address) {
          retargetCvScopeAddress(got.address);
          setParams(withQuery(params, { address: String(got.address) }), { replace: true });
        }
      } catch (err) {
        if (!isCancelled(err) && !ac.signal.aborted) setAddressError(err);
      }
    })();
    return () => ac.abort();
    // Decoder / station only: track and current address are transport, not a reason to re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, config?.enabled, config?.loginRequired, token, query.decoder, query.station]);

  const diffs = useMemo(() => mainCvStore.diffs().map((d) => ({ cv: d.key, value: d.value })), [snap]);

  const registeredSides = useMemo(() => [...sidesRef.current.values()], [sideEpoch]);

  const sections = useMemo((): ChangeSection[] => {
    const out: ChangeSection[] = [];
    if (diffs.length > 0) {
      out.push({
        source: "main",
        labelI18nKey: MAIN_GROUP_KEY,
        entries: diffs.map((d) => ({
          key: String(d.cv),
          label: `CV${d.cv}`,
          value: d.value,
        })),
      });
    }
    for (const side of registeredSides) {
      const sideDiffs = side.store.diffs();
      if (sideDiffs.length === 0) continue;
      out.push({
        source: side.id,
        labelI18nKey: side.labelI18nKey,
        entries: sideDiffs.map((d) => ({
          key: String(d.key),
          label: side.formatEntry(d.key, d.value),
          value: d.value,
        })),
      });
    }
    return out;
    // sideTick: a registered store mutated (set / remember / discard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs, registeredSides, sideTick]);

  const hasPending = sections.length > 0;

  useEffect(() => {
    if (!hasPending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPending]);

  const registerSideTable = useCallback(
    (def: AnySideTable) => {
      // Page-scoped: ESU mapping registers while /mapping is mounted. Diffs and
      // Apply only see sides in this map, so /cv never writes CV 31/32 windows.
      const existing = sidesRef.current.get(def.id);
      if (existing === def) return;
      sidesRef.current.set(def.id, def);
      bumpSides();
    },
    [bumpSides],
  );

  const unregisterSideTable = useCallback(
    (id: string) => {
      if (!sidesRef.current.has(id)) return;
      sidesRef.current.delete(id);
      bumpSides();
    },
    [bumpSides],
  );

  const discard = useCallback(() => {
    mainCvStore.discard();
    for (const side of sidesRef.current.values()) {
      side.store.discard();
    }
  }, []);

  const discardSide = useCallback((id: string) => {
    sidesRef.current.get(id)?.store.discard();
  }, []);

  const sideHasPending = useCallback((id: string) => {
    const side = sidesRef.current.get(id);
    return Boolean(side && side.store.diffs().length > 0);
  }, [sideTick, sideEpoch]);

  const sideTable = useCallback((id: string) => sidesRef.current.get(id)?.store, [sideEpoch]);

  const apply = useCallback(async () => {
    if (applying.current) return;
    const pending = sortCvDiffsForWrite(
      mainCvStore.diffs().map((d) => ({ cv: d.key, value: d.value })),
      getDecoder(query.decoder),
    );
    const sides = [...sidesRef.current.values()];
    const anySide = sides.some((s) => s.store.diffs().length > 0);
    if (pending.length === 0 && !anySide) return;
    applying.current = true;
    setApplyBusy(true);
    setApplyError(null);
    setApplyFailed([]);
    const failedLabels: string[] = [];
    try {
      await programming.withOverlay({ mode: "write" }, async (signal) => {
        // Main first: one numbered-CV write. Side batches come after so CV 31/32
        // index windows are set in the batch, never as a pending main-table diff.
        if (pending.length > 0) {
          const written = await programming.cvWrite({ ...session, cvs: pending, signal });
          const failed = new Set(written.errors);
          const confirmed =
            written.cvs.length > 0 ? written.cvs : pending.filter((d) => !failed.has(d.cv));
          rememberRead(confirmed);
          for (const cv of written.errors) {
            failedLabels.push(`CV${cv}`);
          }
          const touched = new Set(pending.map((d) => d.cv));
          if (touched.has(1) || touched.has(17) || touched.has(18)) {
            const decoder = getDecoder(query.decoder);
            const got = decodeAddress(
              getCv(1) ?? 0,
              getCv(17) ?? 0,
              getCv(18) ?? 0,
              getCv(29) ?? 0,
              decoder?.longAddressBit ?? 5,
            );
            if (got.address >= 1 && got.address !== session.address) {
              retargetCvScopeAddress(got.address);
              setParams(withQuery(params, { address: String(got.address) }), { replace: true });
            }
          }
        }
        for (const side of sides) {
          const sideDiffs = side.store.diffs();
          if (sideDiffs.length === 0) continue;
          const batches = side.applyBatches(sideDiffs);
          for (const batch of batches) {
            const written = await programming.cvWrite({ ...session, cvs: batch.cvs, signal });
            const failed = new Set(written.errors);
            const indexFailed = (batch.rememberMain ?? []).some((e) => failed.has(e.cv));
            if (!indexFailed) {
              const mainConfirmed = (batch.rememberMain ?? []).filter((e) => !failed.has(e.cv));
              if (mainConfirmed.length > 0) {
                rememberRead(mainConfirmed);
              }
              const confirmed = batch.remember.filter((e) => !failed.has(e.cv));
              side.store.rememberRead(confirmed);
            }
            for (const e of batch.remember) {
              if (indexFailed || failed.has(e.cv)) {
                failedLabels.push(side.formatEntry(e.key, e.value));
              }
            }
          }
        }
      });
      setApplyFailed(failedLabels);
    } catch (err) {
      setApplyError(err);
      throw err;
    } finally {
      applying.current = false;
      setApplyBusy(false);
    }
  }, [session, query.decoder, params, setParams]);

  const ensureRead = useCallback(
    async (cvs: number[], signal?: AbortSignal) => {
      if (cvs.every((cv) => getCv(cv) !== undefined)) return;
      const { cvs: got } = await programming.cvRead({
        ...session,
        cvs: cvs.filter((cv) => getCv(cv) === undefined),
        signal,
        stillMissing: () => cvs.filter((cv) => getCv(cv) === undefined),
      });
      rememberRead(got);
    },
    [session],
  );

  const formatSections = useCallback((list: ChangeSection[]) => {
    return list
      .flatMap((section) => section.entries.map((e) => `${e.label}=${e.value}`))
      .join("\n");
  }, []);

  const value = useMemo<CvRegistryValue>(
    () => ({
      get: getCv,
      diffs,
      sections,
      hasPending,
      set: setCv,
      setMany: setCvs,
      setBits: setCvBits,
      rememberRead,
      ensureRead,
      discard,
      discardSide,
      sideHasPending,
      registerSideTable,
      unregisterSideTable,
      sideTable,
      apply,
      applyBusy,
      applyError,
      applyFailed,
      addressError,
      formatDiffs: formatCvDiffs,
      formatSections,
    }),
    [
      diffs,
      sections,
      hasPending,
      ensureRead,
      discard,
      discardSide,
      sideHasPending,
      registerSideTable,
      unregisterSideTable,
      sideTable,
      apply,
      applyBusy,
      applyError,
      applyFailed,
      addressError,
      formatSections,
    ],
  );

  return <CvRegistryContext.Provider value={value}>{children}</CvRegistryContext.Provider>;
}

export function useCvRegistry(): CvRegistryValue {
  const ctx = useContext(CvRegistryContext);
  if (!ctx) {
    throw new Error("useCvRegistry requires CvRegistryProvider");
  }
  return ctx;
}
