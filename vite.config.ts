import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Keep the Japanese dictionary local in both the browser build and the embedded desktop assets.
function searchDictionary(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('kuromoji/package.json'));
  return {
    name: 'search-dictionary',
    configureServer(server) {
      server.middlewares.use('/search-dict', async (request, response, next) => {
        const name = request.url?.split('?')[0].slice(1);
        if (!name || !/^[a-z_]+\.dat\.gz$/.test(name)) return next();
        try {
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(await readFile(join(root, 'dict', name)));
        } catch { response.statusCode = 404; response.end(); }
      });
    },
    async generateBundle() {
      for (const name of await readdir(join(root, 'dict'))) {
        if (name.endsWith('.dat.gz')) this.emitFile({ type: 'asset', fileName: `search-dict/${name}`, source: await readFile(join(root, 'dict', name)) });
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
  plugins: [react(), searchDictionary()],
  optimizeDeps: { include: ['kuromoji/build/kuromoji.js'] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
}));
