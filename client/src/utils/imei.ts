/** Strips everything but digits (barcodes sometimes include stray spaces/dashes). */
export function normalizeImei(rawValue: string): string {
  return rawValue.replace(/\D/g, "");
}

/**
 * Validates a 15-digit IMEI using the standard Luhn (mod 10) check digit.
 */
export function isValidImei(rawValue: string): boolean {
  const digits = normalizeImei(rawValue);
  if (digits.length !== 15) return false;

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
