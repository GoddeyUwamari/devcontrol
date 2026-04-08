import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  webpack(config, { nextRuntime }) {
    // Vercel's Edge Middleware runtime does not expose `node:async_hooks`.
    // Next.js's test-proxy module calls `new AsyncLocalStorage()` at
    // module-init time, which crashes before any try/catch runs
    // (MIDDLEWARE_INVOCATION_FAILED).
    //
    // Fix: override the externals entry so webpack emits an inline IIFE
    // instead of a runtime require() call the edge runtime can't resolve.
    if (nextRuntime === "edge") {
      // Inline polyfill emitted directly into the bundle as a JS expression.
      // webpack externals without a type-prefix are emitted as:
      //   module.exports = <value>;
      // so we can supply an IIFE that returns the stub object without any
      // runtime require() call that the Edge Middleware runtime can't handle.
      const inlinePolyfill =
        "(function(){" +
        "class AsyncLocalStorage{" +
        "run(s,f){var a=Array.prototype.slice.call(arguments,2);return f.apply(void 0,a)}" +
        "getStore(){return undefined}" +
        "enterWith(){}" +
        "disable(){}" +
        "}" +
        "class AsyncResource{" +
        "constructor(t){this.type=t}" +
        "runInAsyncScope(f,t){var a=Array.prototype.slice.call(arguments,2);return f.apply(t,a)}" +
        "bind(f){return f}" +
        "static bind(f){return f}" +
        "}" +
        "return{AsyncLocalStorage:AsyncLocalStorage,AsyncResource:AsyncResource};" +
        "})()";

      if (Array.isArray(config.externals)) {
        config.externals = config.externals.map((ext: any) => {
          // Object externals map: replace the value for node:async_hooks
          if (ext && typeof ext === "object" && !Array.isArray(ext)) {
            const copy = { ...ext };
            if ("async_hooks" in copy) copy["async_hooks"] = inlinePolyfill;
            if ("node:async_hooks" in copy) copy["node:async_hooks"] = inlinePolyfill;
            return copy;
          }
          // Function externals: intercept and return our polyfill expression
          if (typeof ext === "function") {
            return (ctx: any, callback: any) => {
              if (
                ctx.request === "node:async_hooks" ||
                ctx.request === "async_hooks"
              )
                return callback(null, inlinePolyfill);
              return ext(ctx, callback);
            };
          }
          return ext;
        });
      }
    }
    return config;
  },
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
