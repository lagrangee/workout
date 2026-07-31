// @ts-check

import { createHandler } from "./http.js";

export default {
  fetch(request, env, ctx) {
    return createHandler(env).fetch(request, env, ctx);
  },
};
