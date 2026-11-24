import { AsyncLocalStorage } from "async_hooks";

/**
 * Which database a request uses. The demo login (DEMO_PHONE) gets its own
 * SQLite file, so demos never see or change the shop's real data.
 */
type TenantStore = { demo: boolean };

const store = new AsyncLocalStorage<TenantStore>();

/** Demo login number (password is set when the demo database is created). */
export const DEMO_PHONE = (process.env.DEMO_PHONE || "9999999999").trim();
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "123456";

/** Off with DEMO_ENABLED=false (then the demo number logs in to the real data). */
export function demoEnabled() {
  return (process.env.DEMO_ENABLED || "true").toLowerCase() !== "false";
}

export function runWithTenant<T>(demo: boolean, fn: () => T): T {
  return store.run({ demo }, fn);
}

/** True while handling a request from the demo login. */
export function isDemoRequest() {
  return store.getStore()?.demo === true;
}
