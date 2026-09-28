import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: '../../database/migrations',
  verbose: true,
  strict: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
