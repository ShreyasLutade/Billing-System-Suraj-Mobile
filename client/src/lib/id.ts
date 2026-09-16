/**
 * crypto.randomUUID() is missing on non-secure origins (plain http://IP).
 * Polyfill early so bill/exchange draft keys work during GCP IP testing
 * before Cloudflare HTTPS is set up.
 */
export function ensureRandomUUID() {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (!cryptoObj) return;
  if (typeof cryptoObj.randomUUID === "function") return;

  const randomUUID = function randomUUID() {
    if (typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  };

  try {
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: randomUUID,
      configurable: true,
    });
  } catch {
    (cryptoObj as Crypto & { randomUUID: () => string }).randomUUID =
      randomUUID;
  }
}

export function newClientId() {
  ensureRandomUUID();
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
