// @ts-check

const AEROBIC_SYNC_PATH = "/api/private/records/aerobic/sync";
const PUBLICATION_STATUSES = new Set(["complete", "none", "partial", "error"]);

/** @typedef {{ origin?: string, fetchImpl?: typeof fetch, credentials?: RequestCredentials }} PublisherOptions */

/**
 * Create the cloud stage used inside the one user-facing `sync data` flow.
 * The caller supplies the normal Workout application fetch boundary; this
 * adapter never accepts, stores, or logs a bearer credential.
 *
 * @param {PublisherOptions} [options]
 */
export function createAerobicProjectionPublisher(options = {}) {
  if (typeof options.origin !== "string" || !options.origin.trim()) throw new Error("A Workout application origin is required");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const endpoint = new URL(AEROBIC_SYNC_PATH, options.origin);
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("The Workout application origin must use HTTP(S)");

  /** @param {any} projection @param {{ idempotency_key?: string }} [context] */
  return async function publish(projection, context = {}) {
    const idempotencyKey = typeof context.idempotency_key === "string" ? context.idempotency_key : "";
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) throw new Error("A bounded projection idempotency key is required");
    const response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: options.credentials ?? "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ projection }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const error = Object.assign(new Error(payload?.error?.message ?? `Workout application sync failed (${response.status})`), {
        code: payload?.error?.code ?? `http_${response.status}`,
        status: response.status,
        retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
      });
      throw error;
    }
    if (!isValidPublicationResponse(payload, projection)) {
      const error = Object.assign(new Error("Workout application sync returned an invalid response"), {
        code: "invalid_sync_response",
        retryable: false,
      });
      throw error;
    }
    return {
      status: payload.status,
      published_count: Number.isInteger(payload.published_count) ? payload.published_count : 0,
      source_statuses: payload.source_statuses,
      data_as_of: payload.data_as_of ?? null,
    };
  };
}

/** @param {any} payload @param {any} projection */
function isValidPublicationResponse(payload, projection) {
  return Boolean(payload)
    && typeof payload === "object"
    && payload.schema_version === 1
    && payload.publication_key === projection?.publication_key
    && payload.target_date === projection?.target_date
    && typeof payload.status === "string"
    && PUBLICATION_STATUSES.has(payload.status)
    && Number.isInteger(payload.published_count)
    && payload.published_count >= 0
    && payload.published_count <= (Array.isArray(projection?.activities) ? projection.activities.length : 0);
}

/** @param {Response} response */
async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
