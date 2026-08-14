import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "github",
  base: "/fblm/",
  plugins: [react()],
  publicDir: "../public",
  build: {
    outDir: "../dist-gh",
    emptyOutDir: true,
  },
});
