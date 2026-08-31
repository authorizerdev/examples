import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*', // Matches any path starting with /api/
        destination: 'http://localhost:3001/:path*', // Proxy to your backend
      },
    ];
  },
};

export default nextConfig;
