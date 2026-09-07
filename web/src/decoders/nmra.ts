import type { CvItem, DecoderProfile } from "./types";

/** NMRA address + 3-point speed curve — shared by every decoder profile. */
export const nmraBasic: CvItem[] = [
  {
    cv: 1,
    descriptionKey: "catalog.nmra.cv1.description",
    hintKey: "catalog.nmra.cv1.hint",
    min: 1,
    max: 127,
  },
  {
    cv: 2,
    descriptionKey: "catalog.nmra.cv2.description",
    hintKey: "catalog.nmra.cv2.hint",
    min: 0,
    max: 255,
  },
  {
    cv: 3,
    descriptionKey: "catalog.nmra.cv3.description",
    min: 0,
    max: 255,
  },
  {
    cv: 4,
    descriptionKey: "catalog.nmra.cv4.description",
    min: 0,
    max: 255,
  },
  {
    cv: 5,
    descriptionKey: "catalog.nmra.cv5.description",
    min: 0,
    max: 255,
  },
  {
    cv: 6,
    descriptionKey: "catalog.nmra.cv6.description",
    min: 0,
    max: 255,
  },
  {
    cv: 17,
    descriptionKey: "catalog.nmra.cv17.description",
    min: 192,
    max: 231,
  },
  {
    cv: 18,
    descriptionKey: "catalog.nmra.cv18.description",
    min: 0,
    max: 255,
  },
  {
    cv: 29,
    descriptionKey: "catalog.nmra.cv29.description",
    kind: "bits",
    bits: [
      { bit: 0, offKey: "catalog.nmra.cv29.b0.off", onKey: "catalog.nmra.cv29.b0.on" },
      { bit: 1, offKey: "catalog.nmra.cv29.b1.off", onKey: "catalog.nmra.cv29.b1.on" },
      { bit: 2, offKey: "catalog.nmra.cv29.b2.off", onKey: "catalog.nmra.cv29.b2.on" },
      { bit: 5, offKey: "catalog.nmra.cv29.b5.off", onKey: "catalog.nmra.cv29.b5.on" },
    ],
  },
];

/** Generic NMRA decoder: configuration CVs only, no manufacturer extras or volume. */
export const nmra: DecoderProfile = {
  id: "nmra",
  features: ["cv", "speed", "address"],
  cvs: [
    ...nmraBasic,
    {
      cv: 7,
      descriptionKey: "catalog.nmra.cv7.description",
      hintKey: "catalog.nmra.cv7.hint",
      min: 0,
      max: 255,
      readOnly: true,
    },
    {
      cv: 8,
      descriptionKey: "catalog.nmra.cv8.description",
      hintKey: "catalog.nmra.cv8.hint",
      min: 0,
      max: 255,
      readOnly: true,
    },
  ].sort((a, b) => a.cv - b.cv),
};
