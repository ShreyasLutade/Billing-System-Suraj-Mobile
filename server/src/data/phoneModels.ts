/** Popular phone variants for stock search (name · storage · RAM digits, no GB/TB). No color. */

export type PhoneModelSeed = {
  platform: "IOS" | "ANDROID";
  name: string;
  storage: string;
  ram: string;
};

function ios(name: string, storages: string[]): PhoneModelSeed[] {
  return storages.map((storage) => ({
    platform: "IOS" as const,
    name,
    storage,
    ram: "",
  }));
}

function android(
  name: string,
  options: Array<{ storage: string; ram: string }>,
): PhoneModelSeed[] {
  return options.map(({ storage, ram }) => ({
    platform: "ANDROID" as const,
    name,
    storage,
    ram,
  }));
}

/** iPhone — recent + high-demand older models */
const IOS_MODELS: PhoneModelSeed[] = [
  ...ios("iPhone 11", ["64", "128", "256"]),
  ...ios("iPhone 12", ["64", "128", "256"]),
  ...ios("iPhone 12 Pro", ["128", "256", "512"]),
  ...ios("iPhone 13", ["128", "256", "512"]),
  ...ios("iPhone 13 Pro", ["128", "256", "512", "1024"]),
  ...ios("iPhone 13 Pro Max", ["128", "256", "512", "1024"]),
  ...ios("iPhone 14", ["128", "256", "512"]),
  ...ios("iPhone 14 Plus", ["128", "256", "512"]),
  ...ios("iPhone 14 Pro", ["128", "256", "512", "1024"]),
  ...ios("iPhone 14 Pro Max", ["128", "256", "512", "1024"]),
  ...ios("iPhone 15", ["128", "256", "512"]),
  ...ios("iPhone 15 Plus", ["128", "256", "512"]),
  ...ios("iPhone 15 Pro", ["128", "256", "512", "1024"]),
  ...ios("iPhone 15 Pro Max", ["256", "512", "1024"]),
  ...ios("iPhone 16", ["128", "256", "512"]),
  ...ios("iPhone 16 Plus", ["128", "256", "512"]),
  ...ios("iPhone 16 Pro", ["128", "256", "512", "1024"]),
  ...ios("iPhone 16 Pro Max", ["256", "512", "1024"]),
  ...ios("iPhone 16e", ["128", "256", "512"]),
  ...ios("iPhone 17", ["256", "512"]),
  ...ios("iPhone Air", ["256", "512", "1024"]),
  ...ios("iPhone 17 Pro", ["256", "512", "1024"]),
  ...ios("iPhone 17 Pro Max", ["256", "512", "1024", "2048"]),
  ...ios("iPhone 17e", ["256", "512"]),
];

/** Samsung — top flagship + A/M volume models */
const SAMSUNG_MODELS: PhoneModelSeed[] = [
  ...android("Samsung Galaxy S23", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S23 Ultra", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
    { storage: "1024", ram: "12" },
  ]),
  ...android("Samsung Galaxy S24", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S24 FE", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S24 Ultra", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
    { storage: "1024", ram: "12" },
  ]),
  ...android("Samsung Galaxy S25", [
    { storage: "128", ram: "12" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Samsung Galaxy S25 Ultra", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
    { storage: "1024", ram: "12" },
  ]),
  ...android("Samsung Galaxy A15", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A35", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A55", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A16", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A56", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Samsung Galaxy M35", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy F15", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
];

/** OPPO — top 10 India-relevant */
const OPPO_MODELS: PhoneModelSeed[] = [
  ...android("OPPO A3x 5G", [
    { storage: "64", ram: "4" },
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
  ]),
  ...android("OPPO A6x 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OPPO A59 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "6" },
  ]),
  ...android("OPPO A79 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OPPO K12 5G", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OPPO F27 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OPPO Reno11 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OPPO Reno12 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OPPO Reno13 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OPPO Reno14 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

/** vivo — top 10 India-relevant */
const VIVO_MODELS: PhoneModelSeed[] = [
  ...android("vivo Y19s 5G", [
    { storage: "64", ram: "4" },
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
  ]),
  ...android("vivo Y28 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo Y31 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo Y31 Pro 5G", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo Y200 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo T3 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo V29 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("vivo V30 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("vivo V40 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("vivo V50 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

/** OnePlus — top 10 */
const ONEPLUS_MODELS: PhoneModelSeed[] = [
  ...android("OnePlus Nord CE 3 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OnePlus Nord CE 4 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OnePlus Nord CE 4 Lite 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OnePlus Nord 4 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OnePlus Nord CE 5 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OnePlus 11 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "16" },
  ]),
  ...android("OnePlus 12R 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "16" },
  ]),
  ...android("OnePlus 12 5G", [
    { storage: "256", ram: "12" },
    { storage: "256", ram: "16" },
    { storage: "512", ram: "16" },
  ]),
  ...android("OnePlus 13R 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OnePlus 13 5G", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
    { storage: "512", ram: "16" },
  ]),
];

/** Nothing — top lineup (+ CMF) */
const NOTHING_MODELS: PhoneModelSeed[] = [
  ...android("Nothing Phone (1)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Nothing Phone (2)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (2a)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Nothing Phone (2a) Plus", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (3a)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (3a) Pro", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (3)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("CMF Phone 1", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("CMF Phone 2 Pro", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("CMF Phone 2", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
];

/** Infinix — top 10 */
const INFINIX_MODELS: PhoneModelSeed[] = [
  ...android("Infinix Smart 8", [
    { storage: "64", ram: "3" },
    { storage: "64", ram: "4" },
    { storage: "128", ram: "4" },
  ]),
  ...android("Infinix Hot 30", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Hot 40", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Hot 50 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Note 30", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Note 40 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Note 40 Pro 5G", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Infinix Note 50 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Infinix Zero 40 5G", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Infinix GT 20 Pro", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

/** Redmi — top 10 */
const REDMI_MODELS: PhoneModelSeed[] = [
  ...android("Redmi 13C", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi 14C", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi A3", [
    { storage: "64", ram: "3" },
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
  ]),
  ...android("Redmi Note 12 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi Note 12 Pro 5G", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi Note 13 5G", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi Note 13 Pro 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Redmi Note 13 Pro+ 5G", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Redmi Note 14 5G", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi Note 14 Pro 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

/** Google Pixel — top 10 */
const PIXEL_MODELS: PhoneModelSeed[] = [
  ...android("Google Pixel 6a", [
    { storage: "128", ram: "6" },
  ]),
  ...android("Google Pixel 7", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Google Pixel 7a", [
    { storage: "128", ram: "8" },
  ]),
  ...android("Google Pixel 7 Pro", [
    { storage: "128", ram: "12" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Google Pixel 8", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Google Pixel 8a", [
    { storage: "128", ram: "8" },
  ]),
  ...android("Google Pixel 8 Pro", [
    { storage: "128", ram: "12" },
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Google Pixel 9", [
    { storage: "128", ram: "12" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Google Pixel 9 Pro", [
    { storage: "128", ram: "16" },
    { storage: "256", ram: "16" },
    { storage: "512", ram: "16" },
  ]),
  ...android("Google Pixel 9a", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
];

/** Motorola — top 10 */
const MOTOROLA_MODELS: PhoneModelSeed[] = [
  ...android("Motorola G34 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
  ]),
  ...android("Motorola G54 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Motorola G64 5G", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Motorola G84 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Motorola G85 5G", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Motorola Edge 40", [
    { storage: "256", ram: "8" },
  ]),
  ...android("Motorola Edge 50 Fusion", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Motorola Edge 50", [
    { storage: "256", ram: "8" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Motorola Edge 50 Pro", [
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Motorola Edge 60", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

const ANDROID_MODELS: PhoneModelSeed[] = [
  ...SAMSUNG_MODELS,
  ...OPPO_MODELS,
  ...VIVO_MODELS,
  ...ONEPLUS_MODELS,
  ...NOTHING_MODELS,
  ...INFINIX_MODELS,
  ...REDMI_MODELS,
  ...PIXEL_MODELS,
  ...MOTOROLA_MODELS,
];

export const PHONE_MODEL_SEEDS: PhoneModelSeed[] = [
  ...IOS_MODELS,
  ...ANDROID_MODELS,
];
