// @ts-check

import { createHandler } from "./http.js";

let handler;

export default {
  /** @param {Request} request @param {Record<string, any>} env @param {any} ctx */
  fetch(request, env, ctx) {
    handler ??= createHandler(env);
    return handler.fetch(request, env, ctx);
  },
};
