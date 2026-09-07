/** NMRA CV 8 manufacturer ID → Programming Center catalogue profile. */

export interface ManufacturerMatch {
  decoderId: string;
  /** ESU v4 and v5 share CV 8 = 151. */
  esuAmbiguous?: boolean;
}

const BY_CV8: Record<number, ManufacturerMatch> = {
  145: { decoderId: "zimo-ms450" },
  151: { decoderId: "loksound-v5", esuAmbiguous: true },
  172: { decoderId: "rb23xx" },
};

export function matchManufacturer(cv8: number): ManufacturerMatch | null {
  return BY_CV8[cv8] ?? null;
}
