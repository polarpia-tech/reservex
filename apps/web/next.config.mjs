/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@reservex/core', '@reservex/i18n', '@reservex/ui'],
};

export default nextConfig;
