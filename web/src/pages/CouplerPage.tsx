import { Navigate, useSearchParams } from "react-router-dom";
import { useMemo } from "react";

import AppShell from "../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { getDecoder } from "../decoders/registry";
import { esuMappingProfile } from "../features/esuMapping";
import { ZIMO_COUPLER_DECODER_ID } from "../features/zimoCoupler";
import { addressNumber, readQuery, stationNumber } from "../query";
import EsuCouplerPage from "./EsuCouplerPage";
import ZimoCouplerPage from "./ZimoCouplerPage";

export default function CouplerPage() {
  const { config } = useAuth();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);

  const session = useMemo(
    () => ({
      stationId: config?.stationPicker ? stationNumber(query.station) : undefined,
      address: addressNumber(query.address),
      track: query.track,
    }),
    [config?.stationPicker, query.station, query.address, query.track],
  );

  if (!decoder || !decoder.features.includes("coupler")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  if (decoder.id === ZIMO_COUPLER_DECODER_ID) {
    return (
      <AppShell>
        <ZimoCouplerPage decoder={decoder} session={session} />
      </AppShell>
    );
  }

  const esu = esuMappingProfile(decoder.id);
  if (esu) {
    return (
      <AppShell>
        <EsuCouplerPage decoder={decoder} profile={esu} session={session} />
      </AppShell>
    );
  }

  return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
}
