import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { IconFlagDE, IconFlagUK } from "material-ui-flags";

import IconFlagPL from "../components/flags/IconFlagPL";
import type { Language } from "./core";

export {
  LANGUAGE_KEY,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  optionalT,
  setLanguage,
} from "./core";
export type { Language } from "./core";
export { default } from "./core";

export const LANGUAGE_FLAG_ICONS: Record<Language, ComponentType<SvgIconProps>> = {
  pl: IconFlagPL,
  en: IconFlagUK,
  de: IconFlagDE,
};
