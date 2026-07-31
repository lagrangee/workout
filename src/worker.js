// @ts-nocheck

import { createHandler } from "./http.js";

let handler;

export default {
  fetch(request, env, ctx) {
    handler ??= createHandler(env);
    return handler.fetch(request, env, ctx);
  },
};
