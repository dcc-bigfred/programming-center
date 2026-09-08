import { Navigate, useSearchParams } from "react-router-dom";
import { useMemo } from "react";

import AppShell from "../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { getDecoder } from "../decoders/registry";
import { ZIMO_MAPPING_DECODER_ID } from "../features/zimoMapping";
import { addressNumber, readQuery, stationNumber } from "../query";
import ZimoMappingPage from "./ZimoMappingPage";

export default function MappingPage() {
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

  if (!decoder || !decoder.features.includes("mapping")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  if (decoder.id === ZIMO_MAPPING_DECODER_ID) {
    return (
      <AppShell>
        <ZimoMappingPage decoder={decoder} session={session} />
      </AppShell>
    );
  }

  return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
}
