/** India Standard Time helpers (UTC+05:30, no DST). */

export const IST_TIMEZONE = "Asia/Kolkata";

function istYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function istDateString(date = new Date()) {
  const { year, month, day } = istYmd(date);
  return `${year}-${month}-${day}`;
}

export function startOfDayIST(date = new Date()) {
  return new Date(`${istDateString(date)}T00:00:00.000+05:30`);
}

export function endOfDayIST(date = new Date()) {
  return new Date(`${istDateString(date)}T23:59:59.999+05:30`);
}

export function formatISTDate(date: Date | null | undefined) {
  if (!date) return "";
  return date.toLocaleDateString("en-IN", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatISTDateTime(date: Date | null | undefined) {
  if (!date) return "";
  return date.toLocaleString("en-IN", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function isSundayIST(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TIMEZONE,
    weekday: "short",
  }).format(date);
  return weekday === "Sun";
}
