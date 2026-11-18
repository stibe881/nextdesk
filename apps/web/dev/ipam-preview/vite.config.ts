// Dev preview of the IPAM module with mocked `ipam` calls (demo data only):
//   pnpm -C apps/web exec vite --config dev/ipam-preview/vite.config.ts
// then open http://127.0.0.1:5199/
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [
    react(),
    {
      name: "ipam-mock-api",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer &&
          !importer.includes("ipam-preview") &&
          /(^|\/)lib\/ipam-api$/.test(source)
        ) {
          return `${here}mock-ipam.ts`;
        }
        return null;
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
