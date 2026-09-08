import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";

import { ApiError, isCancelled } from "../api/client";

export function errorCode(err: unknown): string {
  if (err instanceof ApiError) {
    return err.code;
  }
  return "generic";
}

function fallbackHint(err: unknown, code: string): string {
  if (err instanceof Error && err.message && err.message !== code) {
    return err.message;
  }
  return code;
}

export function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown): string => {
    const code = errorCode(err);
    if (code === "generic") {
      const hint = fallbackHint(err, "");
      return hint ? `${t("errors.generic")} (${hint})` : t("errors.generic");
    }
    const key = `errors.${code}`;
    const translated = t(key);
    return translated === key ? `${t("errors.generic")} (${fallbackHint(err, code)})` : translated;
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
