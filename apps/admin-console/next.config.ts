import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  basePath: '/admin',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  webpack(config) {
    // Keep external workspace UI imports on the same contract source as this app.
    config.resolve.alias = { ...config.resolve.alias, '@qitu/contracts$': resolve(__dirname, '../../packages/contracts/src/index.ts') };
    // Shared ESM contracts use .js specifiers while this app consumes TS source.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
        basePath: false,
      },
      {
        source: '/admin/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
