import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
    client: 'src/client/index.ts',
  },
  format: 'esm',
  dts: false,
  sourcemap: true,
  clean: false,
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
})
