import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      invariant: 'src/invariant.ts',
      client: 'src/client/index.ts'
    },
    format: 'esm',
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'lib'
  }
])
