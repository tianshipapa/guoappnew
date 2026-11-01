import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { apiMiddleware } from './server/index.mjs';

/**
 * 把本地抓取服务挂进 Vite：dev 与 preview 都能直接用 /api/*，
 * 生产环境用 `npm run serve`（node server/index.mjs）跑同一套路由。
 */
function nativeCorePlugin(): Plugin {
  return {
    name: 'guoappnew-native-core',
    configureServer(server) {
      server.middlewares.use(apiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware());
    },
  };
}

export default defineConfig({
  plugins: [react(), nativeCorePlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
