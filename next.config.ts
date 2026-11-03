import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O pdf.js tenta carregar o pacote opcional "canvas" (só usado no Node); no navegador ele não existe.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
