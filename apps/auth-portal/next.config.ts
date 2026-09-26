import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
};

export default nextConfig;
