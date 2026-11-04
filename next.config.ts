import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O banco local precisa rodar diretamente no Node, sem passar pelo empacotador do Next.
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [{ source: "/", destination: "/pessoas", permanent: false }];
  },
};

export default nextConfig;
