import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@qitu/contracts$': resolve(__dirname, '../../packages/contracts/src/index.ts') };
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  transpilePackages: ['@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
