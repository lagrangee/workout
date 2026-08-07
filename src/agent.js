// @ts-nocheck

import { base64UrlEncode, constantTimeEqual } from "./util.js";

const AGENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/;

/** @param {Record<string, any>} env */
async function deriveHmacKeyBytes(env) {
  const value = env.AGENT_TOKEN_SECRET;
  if (!value) throw new Error("Missing required secret AGENT_TOKEN_SECRET");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/** @param {string} token @param {Record<string, any>} env */
export async function agentTokenDigest(token, env) {
  const key = await deriveHmacKeyBytes(env);
  const cryptoKey = await globalThis.crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateAgentToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** @param {any} state @param {Record<string, any>} env @param {Date} now */
export async function createAgentAccess(state, env, now) {
  const token = generateAgentToken();
  const previous = state.agent_access;
  const nowIso = now.toISOString();
  state.agent_access = {
    token_digest: await agentTokenDigest(token, env),
    created_at: previous?.created_at ?? nowIso,
    rotated_at: previous ? nowIso : null,
    revoked_at: null,
  };
  return { active: true, token, created_at: state.agent_access.created_at, rotated_at: state.agent_access.rotated_at, copy_available: true };
}

/** @param {any} state @param {Date} now */
export function revokeAgentAccess(state, now) {
  if (!state.agent_access || state.agent_access.revoked_at) return { active: false, revoked: false, persist: false };
  state.agent_access.revoked_at = now.toISOString();
  return { active: false, revoked: true, persist: true };
}

/** @param {any} state */
export function agentAccessStatus(state) {
  const access = state.agent_access;
  return {
    active: Boolean(access && !access.revoked_at),
    created_at: access?.created_at ?? null,
    rotated_at: access?.rotated_at ?? null,
    revoked_at: access?.revoked_at ?? null,
  };
}

/** @param {any} store @param {string} token @param {Record<string, any>} env */
export async function findAgentInStore(store, token, env) {
  if (typeof token !== "string" || !AGENT_TOKEN_PATTERN.test(token)) return null;
  const digest = await agentTokenDigest(token, env);
  if (typeof store.findByAgentDigest === "function") return store.findByAgentDigest(digest);
  return (await store.all()).find((state) => state.agent_access && !state.agent_access.revoked_at && constantTimeEqual(state.agent_access.token_digest, digest)) ?? null;
}
