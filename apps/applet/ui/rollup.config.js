import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import copy from "rollup-plugin-copy";

export default {
  input: `src/index.ts`,
  output: [{ dir: './dist', format: 'es', sourcemap: false }],
  // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash-es')
  external: [],
  watch: {
    include: 'src/**',
  },
  plugins: [
    copy({
      targets: [{ src: "icon.png", dest: "dist" }],
    }),
    typescript({}),
    resolve({}),
    commonjs({
      include: [],
    }),
    terser(),
  ],
};
