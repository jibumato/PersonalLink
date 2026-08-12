import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WASM/ネイティブを含むためバンドルせず、実行時に require させる
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
