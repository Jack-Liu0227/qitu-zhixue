import type { NextConfig } from 'next';
import { resolve } from 'node:path';
const config: NextConfig = {
  basePath: '/company',
  experimental: { cpus: 1 },
  transpilePackages: ['@qitu/contracts'],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@qitu/contracts$': resolve(__dirname, '../../packages/contracts/src/index.ts'),
    };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100'}/api/:path*`,
        basePath: false,
      },
    ];
  },
};
export default config;
