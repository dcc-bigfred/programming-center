export type IntegrationMode = "bigfred" | "standalone";
export type ProgrammingMode = "bigfred" | "z21";

export interface Z21Public {
  hostname: string;
  port: number;
}

export interface PublicConfig {
  enabled: boolean;
  mode: IntegrationMode;
  programmingMode: ProgrammingMode;
  ssoClientId: string;
  redirectUris: string[];
  idleTimeoutSecs: number;
  stationPicker: boolean;
  loginRequired: boolean;
  bigfredPublicUrl?: string;
  z21?: Z21Public;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
}

export type Role = "driver" | "signalman" | "admin";

export interface Me {
  id: number;
  login: string;
  role: Role;
  effectiveRole: Role;
  layoutId: number;
  layoutName: string;
}

export interface LoginLayout {
  id: number;
  name: string;
  isSystem: boolean;
}

export interface CommandStation {
  id: number;
  name: string;
  kind: string;
  programming: boolean;
}

export interface CatalogueVehicle {
  id: string;
  name: string;
  number: string;
  dccAddress: number | null;
  isDummy: boolean;
  ownerId: number;
  carrier: string;
}

export interface CvEntry {
  cv: number;
  value: number;
}

export interface ChangeList {
  id: number;
  decoder: string;
  name: string;
  cvs: CvEntry[];
}

export type Track = "prog" | "pom";

export interface Ack {
  ok: boolean;
  error?: string;
  detail?: string;
  cvs?: CvEntry[];
  errors?: number[];
}
