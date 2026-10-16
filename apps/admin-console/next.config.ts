import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/admin',
  transpilePackages: ['@qitu/api-client', '@qitu/auth', '@qitu/contracts', '@qitu/design-tokens', '@qitu/ui'],
  webpack(config) {
    // Shared ESM contracts use .js specifiers while this app consumes TS source.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
