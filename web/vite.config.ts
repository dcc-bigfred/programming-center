import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const devHost = process.env.HOST || "0.0.0.0";
const backend = process.env.PC_BACKEND || "http://127.0.0.1:8092";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@material-ui/core/SvgIcon": path.resolve(rootDir, "node_modules/@mui/material/SvgIcon"),
      "@material-ui/core": path.resolve(rootDir, "node_modules/@mui/material"),
    },
  },
  server: {
    host: devHost,
    allowedHosts: true,
    port: 5176,
    proxy: {
      "/api": { target: backend, changeOrigin: true, ws: true },
      "/healthz": { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    target: "chrome87",
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
