// @ts-nocheck

/** @param {unknown} value */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {unknown} value */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** @param {number} number */
export function roundHalfUp(number, decimals) {
  const factor = 10 ** decimals;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

/** @param {string} text */
export function isValidLocalDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && (() => {
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
  })();
}

/** @param {string} text */
export function isValidUtcInstant(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

/** @param {string} dateText @param {number} days */
export function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {string} from @param {string} to */
export function dateRange(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** @param {string} dateText */
export function weekdayIndex(dateText) {
  const day = new Date(`${dateText}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** @param {string} dateText */
export function weekdayKey(dateText) {
  return WEEKDAYS[weekdayIndex(dateText)];
}

/** @param {string} timezone */
export function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

/** @param {Date} instant @param {string} timezone */
export function localDate(instant, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** @param {Date} instant @param {string} timezone */
export function localDateTimeParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

/** @param {string} value */
export function normalizeEmail(value) {
  return value.trim().normalize("NFKC").toLowerCase();
}

/** @param {string} prefix */
export function opaqueKey(prefix) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id.replaceAll("-", "").slice(0, 24)}`;
}

/** @param {Uint8Array} bytes */
export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} value */
export function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** @param {string} value */
export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} a @param {string} b */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** @param {string} dateText */
export function mondayOf(dateText) {
  return addDays(dateText, -weekdayIndex(dateText));
}

/** @param {string} dateText */
export function formatDate(dateText) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${dateText}T00:00:00Z`));
}

/** @param {unknown} value */
export function trimString(value) {
  return typeof value === "string" ? value.trim() : value;
}
