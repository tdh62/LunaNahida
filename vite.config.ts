import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";

export default defineConfig(() => ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    proxy: { "/api": `http://127.0.0.1:${process.env.LUNANAHIDA_API_PORT || "8787"}` },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
}));
