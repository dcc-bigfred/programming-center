import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MemoryIcon from "@mui/icons-material/Memory";
import SearchIcon from "@mui/icons-material/Search";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { isCancelled } from "../api/client";
import { programming } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { useCvRegistry } from "../cv/CvRegistry";
import { getDecoder, listDecoders } from "../decoders/registry";
import { decoderLabelKey } from "../decoders/types";
import { matchManufacturer } from "../features/detectDecoder";
import { optionalT } from "../i18n";
import { addressNumber, readQuery, stationNumber, withQuery } from "../query";

const tileSx = {
  minHeight: 140,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  px: 2,
  py: 2.5,
} as const;

export default function HomePage() {
  const { t } = useTranslation();
  const { config } = useAuth();
  const registry = useCvRegistry();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const [error, setError] = useState<unknown>(null);
  const [unknownId, setUnknownId] = useState<number | null>(null);
  const [esuInfo, setEsuInfo] = useState(false);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  const pick = (id: string) => {
    setError(null);
    setUnknownId(null);
    setEsuInfo(false);
    setParams(withQuery(params, { decoder: id, cv: null }));
  };

  const detect = async () => {
    setError(null);
    setUnknownId(null);
    setEsuInfo(false);
    try {
      const { cvs } = await programming.cvRead({ ...session, cvs: [8] });
      const cv8 = cvs.find((c) => c.cv === 8)?.value;
      if (cv8 === undefined) {
        throw new Error("empty");
      }
      registry.rememberRead([{ cv: 8, value: cv8 }]);
      const match = matchManufacturer(cv8);
      if (!match) {
        setUnknownId(cv8);
        setParams(withQuery(params, { decoder: "nmra", cv: null }));
        return;
      }
      setParams(withQuery(params, { decoder: match.decoderId, cv: null }));
      setEsuInfo(Boolean(match.esuAmbiguous));
    } catch (err) {
      if (!isCancelled(err)) setError(err);
    }
  };

  return (
    <AppShell>
      <Typography variant="h6" gutterBottom>
        {decoder ? (optionalT(decoderLabelKey(decoder.id)) ?? decoder.id) : t("home.pickDecoder")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("home.lead")}
      </Typography>
      {error ? <ErrorAlert error={error} /> : null}
      {unknownId !== null ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("home.detectUnknown", { id: unknownId })}
        </Alert>
      ) : null}
      {esuInfo ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("home.esuAmbiguous")}
        </Alert>
      ) : null}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 2,
        }}
      >
        {listDecoders().map((d) => {
          const selected = decoder?.id === d.id;
          const label = optionalT(decoderLabelKey(d.id)) ?? d.id;
          return (
            <Card
              key={d.id}
              variant="outlined"
              sx={{
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? "primary.main" : "divider",
              }}
            >
              <CardActionArea sx={tileSx} onClick={() => pick(d.id)}>
                <Stack spacing={1} alignItems="center">
                  <MemoryIcon color={selected ? "primary" : "action"} sx={{ fontSize: 40 }} />
                  <Typography sx={{ fontWeight: 600, fontSize: "1.15rem", textAlign: "center" }}>
                    {label}
                  </Typography>
                </Stack>
              </CardActionArea>
            </Card>
          );
        })}
        <Card
          variant="outlined"
          sx={{
            borderStyle: "dashed",
            borderWidth: 2,
            borderColor: "primary.light",
          }}
        >
          <CardActionArea sx={tileSx} onClick={() => void detect()}>
            <Stack spacing={1} alignItems="center">
              <SearchIcon color="primary" sx={{ fontSize: 40 }} />
              <Typography sx={{ fontWeight: 600, fontSize: "1.15rem", textAlign: "center" }}>
                {t("home.detect")}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: "0.9rem", textAlign: "center" }}>
                {t("home.detectHint")}
              </Typography>
            </Stack>
          </CardActionArea>
        </Card>
      </Box>
    </AppShell>
  );
}
