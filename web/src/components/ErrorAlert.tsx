import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";

import { ApiError, isCancelled } from "../api/client";

export function errorCode(err: unknown): string {
  if (err instanceof ApiError) {
    return err.code;
  }
  return "generic";
}

export function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown): string => {
    const code = errorCode(err);
    const key = `errors.${code}`;
    const translated = t(key);
    return translated === key ? `${t("errors.generic")} (${code})` : translated;
  };
}

export default function ErrorAlert({ error }: { error: unknown }) {
  const describe = useErrorText();
  if (!error || isCancelled(error)) {
    return null;
  }
  return (
    <Alert severity="error" sx={{ my: 2 }}>
      {describe(error)}
    </Alert>
  );
}
