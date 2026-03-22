/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 注意：Next 14 不支持 devIndicators.appIsrStatus（Next 15+ 才有），写上会导致启动报错
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

module.exports = nextConfig;
