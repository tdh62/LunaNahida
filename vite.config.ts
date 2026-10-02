import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dictionaryFiles, dictionaryRoot } from './scripts/search-dictionary.mjs';

// Desktop builds copy dictionaries beside the executable; only static Web builds emit them into dist.
function searchDictionary(mode: string): Plugin {
  const root = dictionaryRoot;
  return {
    name: 'search-dictionary',
    configureServer(server) {
      server.middlewares.use('/search-dict', async (request, response, next) => {
        const name = request.url?.split('?')[0].slice(1);
        if (name === 'manifest.json') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ available: true }));
          return;
        }
        if (!name || !/^[a-z_]+\.dat\.gz$/.test(name)) return next();
        try {
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(await readFile(join(root, 'dict', name)));
        } catch { response.statusCode = 404; response.end(); }
      });
    },
    async generateBundle() {
      if (mode !== 'web') return;
      this.emitFile({ type: 'asset', fileName: 'search-dict/manifest.json', source: JSON.stringify({ available: true }) });
      for (const name of await dictionaryFiles()) {
        this.emitFile({ type: 'asset', fileName: `search-dict/${name}`, source: await readFile(join(root, 'dict', name)) });
      }
      for (const name of ['LICENSE-2.0.txt', 'NOTICE.md']) this.emitFile({ type: 'asset', fileName: `search-dict/${name}`, source: await readFile(join(root, name)) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    proxy: mode === 'web' ? undefined : { "/api": `http://127.0.0.1:${process.env.LUNANAHIDA_API_PORT || "8787"}` },
  },
  preview: { host: '127.0.0.1', port: 8082, proxy: {} },
  plugins: [react(), searchDictionary(mode)],
  optimizeDeps: { include: ['kuromoji/build/kuromoji.js'] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
}));
