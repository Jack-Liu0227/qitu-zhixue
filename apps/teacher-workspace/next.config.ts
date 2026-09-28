import type { NextConfig } from 'next';

const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  basePath: '/teacher',
  // 本地开发用 127.0.0.1 访问时，避免 Next 15 的跨源 dev 资源告警。
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  async redirects() {
    return [
      {
        // 直接访问 3103 根路径时，跳到班主任工作台首页（basePath 外的 / 默认会 404）。
        source: '/',
        destination: '/teacher/dashboard',
        basePath: false,
        permanent: false,
      },
    ];
  },
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
