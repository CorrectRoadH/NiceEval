/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // app/[lang]/layout.jsx 是唯一的 root layout,没法用普通 not-found.jsx 拼出全局 404,
    // 需要 app/global-not-found.jsx 接管未匹配路由。
    globalNotFound: true,
  },
};

export default nextConfig;

