import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import AppShell from "../components/AppShell";
import ErrorAlert from "../components/ErrorAlert";
import { getDecoder } from "../decoders/registry";
import { LONG_MAX } from "../features/dccAddress";
import { readQuery } from "../query";

import { useAddressProgrammer } from "./useAddressProgrammer";

export default function AddressPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const longBit = decoder?.longAddressBit ?? 5;

  const vm = useAddressProgrammer(longBit);

  if (!decoder || !decoder.features.includes("address")) {
    return <Navigate to={{ pathname: "/", search: params.toString() }} replace />;
  }

  return (
    <AppShell>
      <Stack spacing={3}>
        {vm.error ? <ErrorAlert error={vm.error} /> : null}
        <TextField
          type="number"
          label={t("address.value")}
          inputProps={{ min: 1, max: LONG_MAX }}
          value={vm.draft}
          onChange={(e) => vm.setDraft(e.target.value)}
        />
        <Typography color="text.secondary">
          {vm.plan
            ? vm.plan.long
              ? t("address.modeLong")
              : t("address.modeShort")
            : vm.mode === null
              ? t("address.unread")
              : vm.mode === "long"
                ? t("address.modeLong")
                : t("address.modeShort")}
        </Typography>
        <FormControl disabled={vm.busy || !vm.plusKnown}>
          <FormLabel>{t("address.railcomPlus")}</FormLabel>
          <RadioGroup
            value={vm.plusChoice === null ? "" : vm.plusChoice ? "on" : "off"}
            onChange={(e) => vm.setPlusChoice(e.target.value === "on")}
          >
            <FormControlLabel
              value="on"
              control={<Radio />}
              label={t("address.railcomPlusOn")}
            />
            <FormControlLabel
              value="off"
              control={<Radio />}
              label={t("address.railcomPlusOff")}
            />
          </RadioGroup>
        </FormControl>
        <Typography color="text.secondary">
          {vm.plusKnown ? t("address.railcomPlusHint") : t("address.railcomPlusUnknown")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button variant="outlined" disabled={vm.busy} onClick={() => void vm.readAll()}>
            {t("address.read")}
          </Button>
          <Button variant="contained" disabled={!vm.canApply} onClick={() => void vm.apply()}>
            {t("address.save")}
          </Button>
        </Stack>
      </Stack>
    </AppShell>
  );
}
