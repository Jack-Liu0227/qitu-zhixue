import type { NextConfig } from 'next';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  basePath: '/student',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
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
