/** State + actions for the Address page, separated from rendering.
 *
 * Owns draft/mode/busy/error plus the RailComPlus read/choice pair, and the
 * read/apply use-case (including the `address_reverted` fallback that adopts
 * the address the decoder actually still has). The component is a thin view.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { rememberRead, retargetCvScopeAddress } from "../cv/table";
import {
  ADDRESS_READ_CVS,
  decodeAddressFromCvs,
  planWrite,
  readRailcomPlus,
} from "../features/dccAddress";
import { addressNumber, readQuery, stationNumber, withQuery } from "../query";
import { useAuth } from "../auth/AuthContext";
import { useSearchParams } from "react-router-dom";

/** Send `railcomPlus` only when the user changed it from the read value. */
export function changedPlusChoice(
  plusRead: boolean | null,
  plusChoice: boolean | null,
): boolean | undefined {
  if (plusRead === null || plusChoice === null || plusChoice === plusRead) {
    return undefined;
  }
  return plusChoice;
}

export interface AddressProgrammer {
  draft: string;
  setDraft: (v: string) => void;
  mode: "short" | "long" | null;
  busy: boolean;
  error: unknown;
  plusRead: boolean | null;
  plusChoice: boolean | null;
  setPlusChoice: (v: boolean) => void;
  plusKnown: boolean;
  plan: ReturnType<typeof planWrite>;
  canApply: boolean;
  readAll: () => Promise<void>;
  apply: () => Promise<void>;
}

export function useAddressProgrammer(decoderLongBit: number): AddressProgrammer {
  const { config } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const headerAddress = addressNumber(query.address);
  const [draft, setDraft] = useState(headerAddress >= 1 ? String(headerAddress) : "");
  const [mode, setMode] = useState<"short" | "long" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [plusRead, setPlusRead] = useState<boolean | null>(null);
  const [plusChoice, setPlusChoice] = useState<boolean | null>(null);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: headerAddress,
    }),
    [config?.stationPicker, query.station, headerAddress],
  );

  const parsed = Number(draft);
  const plan = planWrite(parsed);
  const longBit = decoderLongBit;
  const canApply = Boolean(plan) && !busy;
  const plusKnown = plusRead !== null;

  useEffect(() => {
    if (headerAddress >= 1) setDraft(String(headerAddress));
  }, [headerAddress]);

  const adopt = useCallback(
    (address: number, long: boolean) => {
      setDraft(String(address));
      setMode(long ? "long" : "short");
      if (address >= 1 && address !== headerAddress) {
        retargetCvScopeAddress(address);
        setParams(withQuery(params, { address: String(address) }), { replace: true });
      }
    },
    [headerAddress, params, setParams],
  );

  const adoptPlus = useCallback((cvs: { cv: number; value: number }[]) => {
    const plus = readRailcomPlus(cvs);
    if (plus === null) return;
    setPlusRead(plus);
    setPlusChoice(plus);
  }, []);

  const applyDecoded = useCallback(
    (cvs: { cv: number; value: number }[]) => {
      const got = decodeAddressFromCvs(cvs, longBit);
      if (!got || got.address < 1) {
        throw new ApiError(0, "cv_read_empty");
      }
      rememberRead(cvs);
      adopt(got.address, got.long);
      adoptPlus(cvs);
    },
    [adopt, adoptPlus, longBit],
  );

  const readAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { cvs } = await programming.cvRead({
        ...session,
        track: "prog",
        cvs: [...ADDRESS_READ_CVS],
      });
      applyDecoded(cvs);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  }, [applyDecoded, session]);

  const apply = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const railcomPlus = changedPlusChoice(plusRead, plusChoice);
    try {
      const written = await programming.withOverlay({ mode: "write" }, (signal) =>
        programming.addressSet({
          ...session,
          newAddress: parsed,
          longBit,
          railcomPlus,
          signal,
        }),
      );
      if (written.errors.length > 0) {
        throw new ApiError(0, "programming_failed");
      }
      rememberRead(written.cvs);
      adopt(parsed, plan.long);
      if (railcomPlus !== undefined) {
        setPlusRead(railcomPlus);
        setPlusChoice(railcomPlus);
      }
    } catch (err) {
      if (!isCancelled(err)) {
        if (err instanceof ApiError && err.code === "address_reverted" && err.cvs?.length) {
          try {
            applyDecoded(err.cvs);
          } catch {
            /* keep address_reverted */
          }
        }
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }, [adopt, adoptPlus, applyDecoded, longBit, parsed, plan, plusChoice, plusRead, session]);

  return {
    draft,
    setDraft,
    mode,
    busy,
    error,
    plusRead,
    plusChoice,
    setPlusChoice,
    plusKnown,
    plan,
    canApply,
    readAll,
    apply,
  };
}
