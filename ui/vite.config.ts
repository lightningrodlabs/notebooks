import { defineConfig } from "vite";
import checker from "vite-plugin-checker";
import { version, dnaVersion } from './package.json';  // Import version from package.json
import wasm from 'vite-plugin-wasm';

const components = [
  "dialog",
  "drawer",
  "dropdown",
  "menu",
  "menu-item",
  "checkbox",
  "divider",
  "menu-label",
  "option",
  "select",
  "tooltip",
  "card",
  "icon-button",
  "button",
  "icon",
  "alert",
  "input",
  "spinner",
  "avatar",
  "skeleton",
];
const exclude = components.map(
  (c) => `@shoelace-style/shoelace/dist/components/${c}/${c}.js`
);
export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify(version),  // Define a global constant
    '__DNA_VERSION__': JSON.stringify(dnaVersion)  // Define a global constant
  },

  build: {
    target: 'esnext', // Support modern JS features including top-level await
  },

  resolve: {
    dedupe: [
      "@holochain-open-dev/elements",
      "@holochain-open-dev/profiles",
      "lit",
    ],
  },

  optimizeDeps: {
    exclude: [
      ...exclude,
      "@holochain-open-dev/elements/dist/elements/display-error.js",
    ],
  },
  plugins: [
    wasm(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: "eslint --ext .ts,.html src",
      },
    }),
  ],
});
