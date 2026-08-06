/** Popular phone variants for stock search (name · storage · RAM digits, no GB/TB). No color. */

export type PhoneModelSeed = {
  platform: "IOS" | "ANDROID";
  name: string;
  storage: string;
  ram: string;
};

function ios(
  name: string,
  storages: string[],
): PhoneModelSeed[] {
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

const IOS_MODELS: PhoneModelSeed[] = [
  ...ios("iPhone 8", ["64", "256"]),
  ...ios("iPhone 8 Plus", ["64", "256"]),
  ...ios("iPhone X", ["64", "256"]),
  ...ios("iPhone XS", ["64", "256", "512"]),
  ...ios("iPhone XS Max", ["64", "256", "512"]),
  ...ios("iPhone SE (2020)", ["64", "128", "256"]),
  ...ios("iPhone SE (2022)", ["64", "128", "256"]),
  ...ios("iPhone XR", ["64", "128", "256"]),
  ...ios("iPhone 11", ["64", "128", "256"]),
  ...ios("iPhone 11 Pro", ["64", "256", "512"]),
  ...ios("iPhone 11 Pro Max", ["64", "256", "512"]),
  ...ios("iPhone 12", ["64", "128", "256"]),
  ...ios("iPhone 12 mini", ["64", "128", "256"]),
  ...ios("iPhone 12 Pro", ["128", "256", "512"]),
  ...ios("iPhone 12 Pro Max", ["128", "256", "512"]),
  ...ios("iPhone 13", ["128", "256", "512"]),
  ...ios("iPhone 13 mini", ["128", "256", "512"]),
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

const ANDROID_MODELS: PhoneModelSeed[] = [
  ...android("Samsung Galaxy S21", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S21 FE", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S22", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S22 Ultra", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Samsung Galaxy S23", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy S23 FE", [
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
  ...android("Samsung Galaxy A14", [
    { storage: "64", ram: "4" },
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
  ]),
  ...android("Samsung Galaxy A15", [
    { storage: "128", ram: "4" },
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A34", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A35", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A54", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Samsung Galaxy A55", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
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
  ...android("OnePlus 11", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "16" },
  ]),
  ...android("OnePlus 12", [
    { storage: "256", ram: "12" },
    { storage: "512", ram: "16" },
  ]),
  ...android("OnePlus Nord CE 3", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OnePlus Nord CE 4", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Xiaomi 14", [
    { storage: "256", ram: "8" },
    { storage: "512", ram: "12" },
  ]),
  ...android("Xiaomi 14 Ultra", [
    { storage: "512", ram: "16" },
  ]),
  ...android("Redmi Note 13", [
    { storage: "128", ram: "6" },
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Redmi Note 13 Pro", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Redmi Note 14", [
    { storage: "128", ram: "6" },
    { storage: "256", ram: "8" },
  ]),
  ...android("vivo V29", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("vivo V30", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("OPPO Reno11", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("OPPO Reno12", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("realme 12 Pro", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (2)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
  ...android("Nothing Phone (2a)", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
  ]),
  ...android("Motorola Edge 50", [
    { storage: "256", ram: "8" },
    { storage: "512", ram: "12" },
  ]),
  ...android("iQOO Neo 9", [
    { storage: "128", ram: "8" },
    { storage: "256", ram: "8" },
    { storage: "256", ram: "12" },
  ]),
];

export const PHONE_MODEL_SEEDS: PhoneModelSeed[] = [
  ...IOS_MODELS,
  ...ANDROID_MODELS,
];
