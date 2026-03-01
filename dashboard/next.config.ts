import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Admin/debug APIs → Alan internal port
      { source: '/api/admin/:path*', destination: 'http://127.0.0.1:7089/admin/:path*' },
      { source: '/api/debug/:path*', destination: 'http://127.0.0.1:7089/debug/:path*' },
      { source: '/api/chat/:path*', destination: 'http://127.0.0.1:7089/chat/:path*' },
      // Chat API → Alan public port (Anthropic format)
      { source: '/api/v1/:path*', destination: 'http://127.0.0.1:7088/v1/:path*' },
    ];
  },
};

export default nextConfig;
