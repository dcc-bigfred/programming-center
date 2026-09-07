import type { CvItem, DecoderProfile } from "./types";

const k = "catalog.rb23xx";

const EFFECT_BASES = [0, 1, 2, 3, 4, 5, 6, 7, 9];

function lightingEffectValues(): number[] {
  const out: number[] = [];
  for (const base of EFFECT_BASES) {
    for (let flags = 0; flags < 16; flags++) {
      const value =
        base +
        ((flags & 1) !== 0 ? 16 : 0) +
        ((flags & 2) !== 0 ? 32 : 0) +
        ((flags & 4) !== 0 ? 64 : 0) +
        ((flags & 8) !== 0 ? 128 : 0);
      if (value <= 135) {
        out.push(value);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const LIGHTING_EFFECTS = lightingEffectValues();

function outputs(
  pairs: { cv: number; n: number }[],
  descriptionKey: string,
  extra: Omit<CvItem, "cv" | "descriptionKey" | "descriptionParams">,
): CvItem[] {
  return pairs.map(({ cv, n }) => ({
    cv,
    descriptionKey,
    descriptionParams: { n },
    ...extra,
  }));
}

function seq(start: number, key: string): CvItem[] {
  return Array.from({ length: 13 }, (_, i) => ({
    cv: start + i,
    descriptionKey: key,
    descriptionParams: { n: i + 1 },
    min: 0,
    max: 255,
  }));
}

const out1to7 = (start: number) =>
  Array.from({ length: 7 }, (_, i) => ({ cv: start + i, n: i + 1 }));
const out8to11 = (start: number) =>
  Array.from({ length: 4 }, (_, i) => ({ cv: start + i, n: i + 8 }));

const rbCore: CvItem[] = [
  {
    cv: 1,
    descriptionKey: `${k}.cv1.description`,
    hintKey: `${k}.cv1.hint`,
    min: 1,
    max: 127,
    default: 3,
  },
  {
    cv: 2,
    descriptionKey: `${k}.cv2.description`,
    hintKey: `${k}.cv2.hint`,
    min: 0,
    max: 127,
    default: 4,
  },
  {
    cv: 3,
    descriptionKey: `${k}.cv3.description`,
    hintKey: `${k}.cv3.hint`,
    min: 0,
    max: 255,
    default: 34,
  },
  {
    cv: 4,
    descriptionKey: `${k}.cv4.description`,
    hintKey: `${k}.cv4.hint`,
    min: 0,
    max: 255,
    default: 25,
  },
  {
    cv: 5,
    descriptionKey: `${k}.cv5.description`,
    hintKey: `${k}.cv5.hint`,
    min: 0,
    max: 255,
    default: 255,
  },
  {
    cv: 6,
    descriptionKey: `${k}.cv6.description`,
    hintKey: `${k}.cv6.hint`,
    min: 10,
    max: 200,
    default: 127,
  },
  {
    cv: 7,
    descriptionKey: `${k}.cv7.description`,
    hintKey: `${k}.cv7.hint`,
    min: 0,
    max: 255,
    default: 172,
    readOnly: true,
  },
  {
    cv: 8,
    descriptionKey: `${k}.cv8.description`,
    hintKey: `${k}.cv8.hint`,
    min: 0,
    max: 255,
    default: 172,
  },
  {
    cv: 17,
    descriptionKey: `${k}.cv17.description`,
    hintKey: `${k}.cv17.hint`,
    min: 192,
    max: 231,
    default: 192,
  },
  {
    cv: 18,
    descriptionKey: `${k}.cv18.description`,
    min: 0,
    max: 255,
    default: 3,
  },
  {
    cv: 19,
    descriptionKey: `${k}.cv19.description`,
    hintKey: `${k}.cv19.hint`,
    min: 0,
    max: 127,
    default: 0,
  },
  {
    cv: 28,
    descriptionKey: `${k}.cv28.description`,
    hintKey: `${k}.cv28.hint`,
    kind: "bits",
    bits: [
      { bit: 0, offKey: `${k}.cv28.b0.off`, onKey: `${k}.cv28.b0.on` },
      { bit: 1, offKey: `${k}.cv28.b1.off`, onKey: `${k}.cv28.b1.on` },
      { bit: 3, offKey: `${k}.cv28.b3.off`, onKey: `${k}.cv28.b3.on` },
    ],
  },
  {
    cv: 29,
    descriptionKey: `${k}.cv29.description`,
    hintKey: `${k}.cv29.hint`,
    kind: "bits",
    bits: [
      { bit: 0, offKey: `${k}.cv29.b0.off`, onKey: `${k}.cv29.b0.on` },
      { bit: 1, offKey: `${k}.cv29.b1.off`, onKey: `${k}.cv29.b1.on` },
      { bit: 2, offKey: `${k}.cv29.b2.off`, onKey: `${k}.cv29.b2.on` },
      { bit: 3, offKey: `${k}.cv29.b3.off`, onKey: `${k}.cv29.b3.on` },
      { bit: 4, offKey: `${k}.cv29.b4.off`, onKey: `${k}.cv29.b4.on` },
    ],
  },
  {
    cv: 50,
    descriptionKey: `${k}.cv50.description`,
    hintKey: `${k}.cv50.hint`,
    min: 0,
    max: 255,
    default: 40,
  },
  {
    cv: 51,
    descriptionKey: `${k}.cv51.description`,
    hintKey: `${k}.cv51.hint`,
    min: 0,
    max: 255,
    default: 130,
  },
  {
    cv: 52,
    descriptionKey: `${k}.cv52.description`,
    hintKey: `${k}.cv52.hint`,
    min: 0,
    max: 255,
    default: 0,
  },
  {
    cv: 53,
    descriptionKey: `${k}.cv53.description`,
    hintKey: `${k}.cv53.hint`,
    min: 0,
    max: 255,
    default: 0,
  },
  {
    cv: 54,
    descriptionKey: `${k}.cv54.description`,
    hintKey: `${k}.cv54.hint`,
    min: 0,
    max: 40,
    default: 7,
  },
  {
    cv: 55,
    descriptionKey: `${k}.cv55.description`,
    hintKey: `${k}.cv55.hint`,
    min: 0,
    max: 40,
    default: 12,
  },
  {
    cv: 58,
    descriptionKey: `${k}.cv58.description`,
    min: 40,
    max: 160,
    default: 80,
  },
  {
    cv: 59,
    descriptionKey: `${k}.cv59.description`,
    min: 6,
    max: 20,
    default: 6,
  },
  {
    cv: 60,
    descriptionKey: `${k}.cv60.description`,
    hintKey: `${k}.cv60.hint`,
    min: 30,
    max: 90,
    default: 90,
  },
  {
    cv: 61,
    descriptionKey: `${k}.cv61.description`,
    hintKey: `${k}.cv61.hint`,
    min: 0,
    max: 255,
    default: 10,
  },
  {
    cv: 62,
    descriptionKey: `${k}.cv62.description`,
    hintKey: `${k}.cv62.hint`,
    min: 0,
    max: 255,
    default: 10,
  },
  {
    cv: 63,
    descriptionKey: `${k}.cv63.description`,
    hintKey: `${k}.cv63.hint`,
    min: 0,
    max: 255,
    default: 10,
  },
  {
    cv: 64,
    descriptionKey: `${k}.cv64.description`,
    hintKey: `${k}.cv64.hint`,
    kind: "bits",
    bits: [
      { bit: 0, offKey: `${k}.cv64.b0.off`, onKey: `${k}.cv64.b0.on` },
      { bit: 1, offKey: `${k}.cv64.b1.off`, onKey: `${k}.cv64.b1.on` },
      { bit: 3, offKey: `${k}.cv64.b3.off`, onKey: `${k}.cv64.b3.on` },
    ],
  },
  {
    cv: 110,
    descriptionKey: `${k}.cv110.description`,
    hintKey: `${k}.cv110.hint`,
    min: 0,
    max: 255,
    default: 23,
    readOnly: true,
  },
  {
    cv: 111,
    descriptionKey: `${k}.cv111.description`,
    hintKey: `${k}.cv111.hint`,
    min: 0,
    max: 255,
    default: 0,
    readOnly: true,
  },
  ...outputs(out1to7(112), `${k}.effect.description`, {
    hintKey: `${k}.effect.hint`,
    min: 0,
    max: 135,
    default: 0,
    allowedValues: LIGHTING_EFFECTS,
  }),
  ...outputs(out1to7(119), `${k}.brightnessMax.description`, {
    min: 0,
    max: 255,
    default: 255,
  }),
  ...outputs(out1to7(126), `${k}.brightnessMin.description`, {
    min: 0,
    max: 255,
    default: 0,
  }),
  {
    cv: 133,
    descriptionKey: `${k}.cv133.description`,
    hintKey: `${k}.cv133.hint`,
    min: 0,
    max: 255,
    default: 100,
  },
  {
    cv: 134,
    descriptionKey: `${k}.cv134.description`,
    hintKey: `${k}.cv134.hint`,
    min: 0,
    max: 255,
    default: 100,
  },
  {
    cv: 135,
    descriptionKey: `${k}.cv135.description`,
    min: 0,
    max: 255,
    default: 20,
  },
  {
    cv: 136,
    descriptionKey: `${k}.cv136.description`,
    min: 0,
    max: 255,
    default: 50,
  },
  {
    cv: 137,
    descriptionKey: `${k}.cv137.description`,
    hintKey: `${k}.cv137.hint`,
    min: 0,
    max: 255,
    default: 1,
  },
  {
    cv: 138,
    descriptionKey: `${k}.cv138.description`,
    min: 0,
    max: 255,
    default: 1,
  },
  ...seq(139, `${k}.seq1.description`),
  ...seq(152, `${k}.seq2.description`),
  {
    cv: 165,
    descriptionKey: `${k}.cv165.description`,
    hintKey: `${k}.cv165.hint`,
    min: 0,
    max: 28,
    default: 6,
  },
  {
    cv: 167,
    descriptionKey: `${k}.cv167.description`,
    hintKey: `${k}.cv167.hint`,
    min: 0,
    max: 2,
    default: 0,
  },
  {
    cv: 192,
    descriptionKey: `${k}.cv192.description`,
    hintKey: `${k}.cv192.hint`,
    min: 0,
    max: 68,
    default: 1,
  },
  {
    cv: 193,
    descriptionKey: `${k}.cv193.description`,
    hintKey: `${k}.cv193.hint`,
    min: 0,
    max: 200,
    default: 100,
  },
  {
    cv: 194,
    descriptionKey: `${k}.cv194.description`,
    hintKey: `${k}.cv194.hint`,
    min: 0,
    max: 255,
    default: 255,
  },
  {
    cv: 195,
    descriptionKey: `${k}.cv195.description`,
    min: 0,
    max: 255,
    default: 10,
  },
  {
    cv: 196,
    descriptionKey: `${k}.cv196.description`,
    min: 0,
    max: 255,
    default: 10,
  },
  {
    cv: 200,
    descriptionKey: `${k}.cv200.description`,
    hintKey: `${k}.cv200.hint`,
    min: 0,
    max: 100,
    default: 28,
  },
  {
    cv: 201,
    descriptionKey: `${k}.cv201.description`,
    hintKey: `${k}.cv201.hint`,
    min: 20,
    max: 80,
    default: 40,
  },
  {
    cv: 202,
    descriptionKey: `${k}.cv202.description`,
    hintKey: `${k}.cv202.hint`,
    kind: "enum",
    min: 1,
    max: 3,
    default: 1,
    options: [
      { value: 1, labelKey: `${k}.cv202.pack1` },
      { value: 2, labelKey: `${k}.cv202.pack2` },
      { value: 3, labelKey: `${k}.cv202.pack3` },
    ],
  },
  {
    cv: 203,
    descriptionKey: `${k}.cv203.description`,
    hintKey: `${k}.cv203.hint`,
    min: 0,
    max: 255,
    default: 64,
  },
  {
    cv: 204,
    descriptionKey: `${k}.cv204.description`,
    hintKey: `${k}.cv204.hint`,
    min: 0,
    max: 100,
    default: 35,
  },
  {
    cv: 205,
    descriptionKey: `${k}.cv205.description`,
    hintKey: `${k}.cv205.hint`,
    min: 0,
    max: 100,
    default: 95,
  },
  {
    cv: 206,
    descriptionKey: `${k}.cv206.description`,
    hintKey: `${k}.cv206.hint`,
    min: 0,
    max: 100,
    default: 22,
  },
  {
    cv: 207,
    descriptionKey: `${k}.cv207.description`,
    hintKey: `${k}.cv207.hint`,
    min: 0,
    max: 100,
    default: 23,
  },
  {
    cv: 208,
    descriptionKey: `${k}.cv208.description`,
    hintKey: `${k}.cv208.hint`,
    kind: "bits",
    bits: [
      { bit: 0, offKey: `${k}.cv208.b0.off`, onKey: `${k}.cv208.b0.on` },
      { bit: 1, offKey: `${k}.cv208.b1.off`, onKey: `${k}.cv208.b1.on` },
      { bit: 2, offKey: `${k}.cv208.b2.off`, onKey: `${k}.cv208.b2.on` },
      { bit: 3, offKey: `${k}.cv208.b3.off`, onKey: `${k}.cv208.b3.on` },
      { bit: 4, offKey: `${k}.cv208.b4.off`, onKey: `${k}.cv208.b4.on` },
    ],
  },
  {
    cv: 209,
    descriptionKey: `${k}.cv209.description`,
    hintKey: `${k}.cv209.hint`,
    kind: "enum",
    min: 0,
    max: 1,
    default: 0,
    options: [
      { value: 0, labelKey: `${k}.cv209.nem660` },
      { value: 1, labelKey: `${k}.cv209.mkl` },
    ],
  },
  {
    cv: 210,
    descriptionKey: `${k}.cv210.description`,
    hintKey: `${k}.cv210.hint`,
    min: 1,
    max: 255,
    default: 100,
  },
  ...outputs(out8to11(212), `${k}.effect.description`, {
    hintKey: `${k}.effect.hint`,
    min: 0,
    max: 135,
    default: 0,
    allowedValues: LIGHTING_EFFECTS,
  }),
  ...outputs(out8to11(219), `${k}.brightnessMax.description`, {
    min: 0,
    max: 255,
    default: 255,
  }),
  ...outputs(out8to11(226), `${k}.brightnessMin.description`, {
    min: 0,
    max: 255,
    default: 0,
  }),
];

export const rb23xx: DecoderProfile = {
  id: "rb23xx",
  features: ["cv", "speed", "address", "volume"],
  longAddressBit: 3,
  cvs: [...rbCore].sort((a, b) => a.cv - b.cv),
};
