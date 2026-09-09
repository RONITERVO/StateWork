import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        work: fileURLToPath(new URL('index.html', import.meta.url)),
        spatial: fileURLToPath(new URL('spatial/index.html', import.meta.url)),
        instructions: fileURLToPath(new URL('instructions/index.html', import.meta.url)),
      },
    },
  },
});
