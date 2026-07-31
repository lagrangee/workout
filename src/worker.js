// @ts-check

import { createHandler } from "./http.js";

/** @typedef {import("./types.js").WorkerEnv} WorkerEnv */
/** @typedef {import("./types.js").WorkerExecutionContext} WorkerExecutionContext */

let handler;

export default {
  /** @param {Request} request @param {WorkerEnv} env @param {WorkerExecutionContext} ctx */
  fetch(request, env, ctx) {
    handler ??= createHandler(env);
    return handler.fetch(request, env, ctx);
  },
};
