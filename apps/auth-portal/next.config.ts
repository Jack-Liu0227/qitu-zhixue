import type { NextConfig } from 'next';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  transpilePackages: ['@qitu/design-tokens', '@qitu/ui'],
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
