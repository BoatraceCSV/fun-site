import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env["SITE_URL"] ?? "https://fun-site.example.com",
  vite: {
    plugins: [tailwindcss()],
  },
});
