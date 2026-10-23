import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5290, strictPort: true },
  preview: { port: 5291, strictPort: true },
});
