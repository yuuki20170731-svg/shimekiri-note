import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { sites } from "./build/sites-vite-plugin";
import { publicConfig } from "./lib/public-config";

export default defineConfig(({ mode }) => {
  const values = publicConfig(loadEnv(mode, process.cwd(), "NEXT_PUBLIC_"));
  const publicKeys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  ] as const;
  return {
    plugins: [react(), sites({ mockAuth: false })],
    resolve: {
      alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
      dedupe: ["react", "react-dom"],
    },
    define: Object.fromEntries(
      publicKeys.map((key) => [
        `process.env.${key}`,
        JSON.stringify(values[key] ?? ""),
      ]),
    ),
    server: { host: "localhost", port: 5173, strictPort: true },
    preview: { host: "localhost", port: 5173, strictPort: true },
  };
});
