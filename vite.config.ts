import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_PORT = process.env.PORT || '4000';
const api = `http://localhost:${API_PORT}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/graphql': api, '/metrics': api, '/healthz': api },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
          // Load graphql and everything that imports it through one resolver, so there is a single
          // GraphQLError class. Two copies make Yoga mask expected errors as unexpected ones.
          server: { deps: { inline: ['graphql', 'graphql-yoga', /@graphql-tools\//, /@envelop\//] } },
        },
      },
      {
        extends: true,
        test: { name: 'web', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' },
      },
    ],
  },
});
