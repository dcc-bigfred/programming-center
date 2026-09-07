import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import { getDecoder } from "../decoders/registry";
import {
  ADDRESS_CVS,
  LONG_MAX,
  bitopForLong,
  decodeAddressFromCvs,
  planWrite,
} from "../features/dccAddress";
import { addressNumber, readQuery, stationNumber } from "../query";
import { useAuth } from "../auth/AuthContext";

export default function AddressPage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const registry = useCvRegistry();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const headerAddress = addressNumber(query.address);
  const [draft, setDraft] = useState(headerAddress >= 1 ? String(headerAddress) : "");
  const [mode, setMode] = useState<"short" | "long" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: headerAddress,
      track: query.track,
    }),
    [config?.stationPicker, query.station, headerAddress, query.track],
  );

  const parsed = Number(draft);
  const plan = planWrite(parsed);
  const longBit = decoder?.longAddressBit ?? 5;

  useEffect(() => {
    if (headerAddress >= 1) setDraft(String(headerAddress));
  }, [headerAddress]);

  useEffect(() => {
    const entries = ADDRESS_CVS.flatMap((cv) => {
      const value = registry.get(cv);
      return value === undefined ? [] : [{ cv, value }];
    });
    const got = decodeAddressFromCvs(entries, longBit);
    if (!got || got.address < 1) return;
    setDraft(String(got.address));
    setMode(got.long ? "long" : "short");
  }, [registry.diffs, longBit]);

  if (!decoder || !decoder.features.includes("address")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  const stagePlan = async (next: NonNullable<ReturnType<typeof planWrite>>) => {
    registry.setMany(next.cvs);
    setMode(next.long ? "long" : "short");
    try {
      await registry.ensureRead([29]);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
      return;
    }
    const bitop = bitopForLong(next.long, longBit);
    registry.setBits(29, bitop.andMask, bitop.orMask);
  };

  const applyDecoded = (cvs: { cv: number; value: number }[]) => {
    const got = decodeAddressFromCvs(cvs, longBit);
    if (!got || got.address < 1) {
      throw new Error("empty");
    }
    setDraft(String(got.address));
    setMode(got.long ? "long" : "short");
  };

  const readAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const { cvs } = await programming.cvRead({ ...session, cvs: [...ADDRESS_CVS] });
      registry.rememberRead(cvs);
      applyDecoded(cvs);
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <Stack spacing={3}>
        {error ? <ErrorAlert error={error} /> : null}
        <Typography color="text.secondary">{t("address.hint")}</Typography>
        <TextField
          type="number"
          label={t("address.value")}
          inputProps={{ min: 1, max: LONG_MAX }}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const planned = planWrite(Number(next));
            if (planned) void stagePlan(planned);
          }}
        />
        <Typography color="text.secondary">
          {plan
            ? plan.long
              ? t("address.modeLong")
              : t("address.modeShort")
            : mode === null
              ? t("address.unread")
              : mode === "long"
                ? t("address.modeLong")
                : t("address.modeShort")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button variant="outlined" disabled={busy} onClick={() => void readAll()}>
            {t("address.read")}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}
