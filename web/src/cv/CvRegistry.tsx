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
import {
  cvDiffs,
  discardCvTable,
  ensureCvScope,
  formatCvDiffs,
  getCv,
  getCvSnapshot,
  rememberRead,
  retargetCvScopeAddress,
  setCv,
  setCvBits,
  setCvs,
  subscribeCvTable,
  type CvDiff,
} from "./table";
import { indexedCvDiffs, subscribeIndexedCvTable, getIndexedCvSnapshot } from "./indexedTable";

interface CvRegistryValue {
  get: (cv: number) => number | undefined;
  diffs: CvDiff[];
  set: (cv: number, value: number) => void;
  setMany: (entries: CvDiff[]) => void;
  setBits: (cv: number, andMask: number, orMask: number) => void;
  rememberRead: (entries: CvDiff[]) => void;
  ensureRead: (cvs: number[], signal?: AbortSignal) => Promise<void>;
  discard: () => void;
  apply: () => Promise<void>;
  applyBusy: boolean;
  applyError: unknown;
  applyFailed: number[];
  addressError: unknown;
  formatDiffs: (diffs: CvDiff[]) => string;
}

const CvRegistryContext = createContext<CvRegistryValue | null>(null);

export function CvRegistryProvider({ children }: { children: ReactNode }) {
  const { config, token, ready } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const snap = useSyncExternalStore(subscribeCvTable, getCvSnapshot, getCvSnapshot);
  const indexedSnap = useSyncExternalStore(
    subscribeIndexedCvTable,
    getIndexedCvSnapshot,
    getIndexedCvSnapshot,
  );
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<unknown>(null);
  const [applyFailed, setApplyFailed] = useState<number[]>([]);
  const [addressError, setAddressError] = useState<unknown>(null);
  const applying = useRef(false);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  useLayoutEffect(() => {
    ensureCvScope({
      decoder: query.decoder,
      address: session.address,
      station: query.station,
    });
  }, [query.decoder, query.station, session.address]);

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

  const diffs = useMemo(() => cvDiffs(snap), [snap]);
  const indexedDirty = indexedCvDiffs(indexedSnap).length;

  useEffect(() => {
    if (diffs.length === 0 && indexedDirty === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [diffs.length, indexedDirty]);

  const apply = useCallback(async () => {
    const pending = sortCvDiffsForWrite(cvDiffs(), getDecoder(query.decoder));
    if (pending.length === 0) return;
    if (applying.current) return;
    applying.current = true;
    setApplyBusy(true);
    setApplyError(null);
    setApplyFailed([]);
    try {
      const written = await programming.withOverlay({ mode: "write" }, (signal) =>
        programming.cvWrite({ ...session, cvs: pending, signal }),
      );
      const failed = new Set(written.errors);
      const confirmed =
        written.cvs.length > 0 ? written.cvs : pending.filter((d) => !failed.has(d.cv));
      rememberRead(confirmed);
      setApplyFailed(written.errors);
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

  const value = useMemo<CvRegistryValue>(
    () => ({
      get: getCv,
      diffs,
      set: setCv,
      setMany: setCvs,
      setBits: setCvBits,
      rememberRead,
      ensureRead,
      discard: discardCvTable,
      apply,
      applyBusy,
      applyError,
      applyFailed,
      addressError,
      formatDiffs: formatCvDiffs,
    }),
    [diffs, apply, applyBusy, applyError, applyFailed, addressError, ensureRead],
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
