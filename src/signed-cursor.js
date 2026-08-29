// @ts-check

import { base64UrlDecode, base64UrlEncode } from "./util.js";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 4096;
const encoder = new TextEncoder();

/** @param {string} secret */
async function signingKey(secret) {
  if (typeof secret !== "string" || !secret) throw new Error("Signed cursor requires a service secret");
  return globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** @param {string} domain @param {string} subject @param {string} payload */
function signatureInput(domain, subject, payload) {
  if (!domain || !subject) throw new Error("Signed cursor requires domain and subject bindings");
  return encoder.encode(`workout-signed-cursor-v${CURSOR_VERSION}\u0000${domain}\u0000${subject}\u0000${payload}`);
}

/** @param {Record<string, unknown>} value @param {{ secret: string, domain: string, subject: string }} context */
export async function issueSignedCursor(value, context) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ ...value, v: CURSOR_VERSION })));
  const signature = await globalThis.crypto.subtle.sign("HMAC", await signingKey(context.secret), signatureInput(context.domain, context.subject, payload));
  return `v${CURSOR_VERSION}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** @param {string|null} token @param {{ secret: string, domain: string, subject: string }} context */
export async function verifySignedCursor(token, context) {
  if (typeof token !== "string" || !token || token.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== `v${CURSOR_VERSION}` || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
    const signature = base64UrlDecode(parts[2]);
    if (signature.byteLength !== 32) return null;
    const valid = await globalThis.crypto.subtle.verify("HMAC", await signingKey(context.secret), signature, signatureInput(context.domain, context.subject, parts[1]));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    return value && typeof value === "object" && !Array.isArray(value) && value.v === CURSOR_VERSION ? value : null;
  } catch {
    return null;
  }
}
