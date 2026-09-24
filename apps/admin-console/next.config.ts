import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@qitu/api-client', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
};

export default nextConfig;
