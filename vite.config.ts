import { defineConfig, loadEnv } from "vite";
import { cwd } from "node:process";
import react from "@vitejs/plugin-react";
import { validatePublicEnvironment } from "./scripts/environment";
export default defineConfig(({ mode }) => {
  validatePublicEnvironment(loadEnv(mode, cwd(), "VITE_"));
  return { plugins: [react()], build: { sourcemap: false } };
});
