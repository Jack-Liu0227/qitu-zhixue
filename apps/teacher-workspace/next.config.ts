import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/teacher',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
};

export default nextConfig;
