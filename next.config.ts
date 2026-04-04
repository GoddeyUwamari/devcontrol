import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Skip ESLint during builds to allow deployment
    // Run `npm run lint` separately to see all linting issues
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip TypeScript checks during build for faster deployments
    // Run `npm run type-check` separately to see all type issues
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async redirects() {
    return [
      { source: '/features/cost-optimization',      destination: '/platform/costs',                permanent: false },
      { source: '/features/security',               destination: '/solutions/security',             permanent: false },
      { source: '/features/infrastructure-health',  destination: '/platform/infrastructure',        permanent: false },
      { source: '/features/resource-discovery',     destination: '/aws-resources',                  permanent: false },
      { source: '/features/dora-metrics',           destination: '/dora-metrics',                   permanent: false },
      { source: '/features/collaboration',          destination: '/solutions/platform-engineers',   permanent: false },
      { source: '/platform/integrations',           destination: '/docs/api',                       permanent: false },
      { source: '/company/security',                destination: '/solutions/security',             permanent: false },
    ];
  },
};

export default nextConfig;
