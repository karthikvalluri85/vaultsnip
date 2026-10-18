// Vitest settings. Builds live in tools/build-ml.mjs (Feature 2) and tools/build-ext.mjs.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
