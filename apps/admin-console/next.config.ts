import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  basePath: '/admin',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  webpack(config) {
    // Keep external workspace UI imports on the same contract source as this app.
    config.resolve.alias = { ...config.resolve.alias, '@qitu/contracts$': resolve(__dirname, '../../packages/contracts/src/index.ts') };
    // Shared ESM contracts use .js specifiers while this app consumes TS source.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
