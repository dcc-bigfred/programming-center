import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const devHost = process.env.HOST || "localhost";

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
    allowedHosts: ["programming-center.local", "bigfred.local"],
    port: 5176,
    proxy: {
      "/api": { target: "http://localhost:8092", changeOrigin: true, ws: true },
      "/healthz": { target: "http://localhost:8092", changeOrigin: true },
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
