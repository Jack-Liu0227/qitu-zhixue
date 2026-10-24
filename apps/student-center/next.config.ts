import type { NextConfig } from 'next';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  basePath: '/student',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  webpack(config) {
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
    ];
  },
};

export default nextConfig;
