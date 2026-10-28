import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { validateMobileApi } from "./scripts/mobile-config.ts";

export default defineConfig(({ mode }) => {
  if (mode === "mobile") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    validateMobileApi(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL);
  }
  return {
    plugins: [react()],
    ...(mode === "lan"
      ? {
          define: {
            "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api/v1"),
          },
          server: {
            host: "0.0.0.0",
            port: 5173,
            strictPort: true,
            proxy: {
              "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
            },
          },
        }
      : {}),
  };
});
