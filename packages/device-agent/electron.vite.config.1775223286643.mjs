// electron.vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
var __electron_vite_injected_dirname = "C:\\Users\\mail\\Development\\comp-ai\\packages\\device-agent";
var __electron_vite_injected_import_meta_url = "file:///C:/Users/mail/Development/comp-ai/packages/device-agent/electron.vite.config.ts";
var require2 = createRequire(__electron_vite_injected_import_meta_url);
var pkg = require2("./package.json");
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["electron-store"] })],
    define: {
      __PORTAL_URL__: JSON.stringify(
        process.env.PORTAL_URL || "https://portal.trycomp.ai"
      ),
      __API_URL__: JSON.stringify(
        process.env.API_URL || "https://api.trycomp.ai"
      ),
      __AGENT_VERSION__: JSON.stringify(
        process.env.AGENT_VERSION || pkg.version
      )
    },
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts")
        }
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    build: {
      outDir: resolve(__electron_vite_injected_dirname, "dist/renderer"),
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
