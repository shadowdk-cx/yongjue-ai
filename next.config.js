/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Zeabur 等非交互环境下 ESLint 未完整配置时，构建阶段 lint 可能失败或卡住
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 注意：Next 14 不支持 devIndicators.appIsrStatus（Next 15+ 才有），写上会导致启动报错
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

module.exports = nextConfig;
