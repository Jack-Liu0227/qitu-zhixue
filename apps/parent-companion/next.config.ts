import type { NextConfig } from 'next';

// 与 teacher / auth 应用保持同一约定：本地开发把相对路径 /api/* 代理到后端，
// 避免跨源直连 :4100 时浏览器丢弃 cookie 导致 401。
const apiOrigin = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  basePath: '/parent',
  transpilePackages: [
    '@qitu/api-client',
    '@qitu/auth',
    '@qitu/contracts',
    '@qitu/design-tokens',
    '@qitu/ui',
  ],
  async rewrites() {
    return [
      {
        // api-client 使用相对路径 /api/v1/...，这里覆盖整个 /api/* 前缀。
        // basePath: false 让 /parent/api/* 之外的裸 /api/* 也命中代理。
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
