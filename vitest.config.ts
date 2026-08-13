import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const sharedAlias = {
  // More specific aliases must come before the "@" catch-all.
  "server-only": path.resolve(__dirname, "__mocks__/server-only.ts"),
  "@/i18n/navigation": path.resolve(__dirname, "__mocks__/i18n-navigation.ts"),
  "next/cache": path.resolve(__dirname, "__mocks__/next-cache.ts"),
  "@": path.resolve(__dirname, "."),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: sharedAlias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: sharedAlias },
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["__tests__/unit/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: sharedAlias },
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          setupFiles: ["./vitest.integration.setup.ts"],
          include: ["__tests__/integration/**/*.{test,spec}.{ts,tsx}"],
        },
      },
    ],
  },
});
