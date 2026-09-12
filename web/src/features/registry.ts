import type { SvgIconComponent } from "@mui/icons-material";
import BackupIcon from "@mui/icons-material/Backup";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import LinkIcon from "@mui/icons-material/Link";
import MemoryIcon from "@mui/icons-material/Memory";
import PinIcon from "@mui/icons-material/Pin";
import SpeedIcon from "@mui/icons-material/Speed";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

import type { DecoderProfile, FeatureId } from "../decoders/types";

export interface FeatureModule {
  id: FeatureId;
  path: string;
  Icon: SvgIconComponent;
  requiresDecoder?: boolean;
}

const FEATURES: FeatureModule[] = [
  { id: "cv", path: "/cv", Icon: MemoryIcon },
  { id: "speed", path: "/speed", Icon: SpeedIcon },
  { id: "address", path: "/address", Icon: PinIcon },
  { id: "volume", path: "/volume", Icon: VolumeUpIcon },
  { id: "mapping", path: "/mapping", Icon: LightbulbOutlinedIcon },
  { id: "coupler", path: "/coupler", Icon: LinkIcon },
  { id: "backup", path: "/backup", Icon: BackupIcon, requiresDecoder: false },
];

export function listFeatures(): FeatureModule[] {
  return FEATURES;
}

/** Backup is always on; other tiles follow `decoder.features`. */
export function isFeatureEnabled(
  feature: FeatureModule,
  decoder: DecoderProfile | undefined,
): boolean {
  return feature.requiresDecoder === false || Boolean(decoder?.features.includes(feature.id));
}

/** Nav list: every kiosk module. `isFeatureEnabled` greys out tiles the profile lacks. */
export function featuresFor(decoder: DecoderProfile): FeatureModule[] {
  return FEATURES.filter((f) => !f.requiresDecoder || decoder.features.includes(f.id));
}
