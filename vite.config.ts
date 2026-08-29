import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(repositoryRoot, "web"),
  publicDir: resolve(repositoryRoot, "public"),
  plugins: [vue()],
  build: {
    outDir: resolve(repositoryRoot, "dist"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 8787,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8788",
      "/healthz": "http://127.0.0.1:8788",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
  },
});
