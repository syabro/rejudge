import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://rejudge.syabro.com",
  output: "static",
  build: {
    format: "directory",
  },
});
