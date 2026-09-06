/** @type {import('next').NextConfig} */
const nextConfig = {
  optimizeFonts: false,   // disable build-time font download (fonts load at runtime)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  poweredByHeader: false,
  // Required for @supabase/supabase-js + @react-pdf/renderer in serverless.
  // Promoted out of `experimental` to this stable top-level key in
  // Next.js 15 — the old experimental.serverComponentsExternalPackages
  // still worked under 15.5.23 via a backward-compat shim (with a build
  // warning), but that's not something to depend on staying around.
  serverExternalPackages: [
    '@supabase/ssr',
    '@supabase/supabase-js',
    '@react-pdf/renderer',
  ],
  experimental: {},

  // ── HTTP security & CORS headers ────────────────────────────────────────
  async headers() {
    return [
      // ── Global security headers on every route ───────────────────────────
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security',  value: 'max-age=31536000; includeSubDomains' },
        ],
      },

      // ── Demo API: explicit CORS for the public SSE endpoint ───────────────
      //
      // We restrict Access-Control-Allow-Origin to our own domain rather than
      // using '*' because the route performs per-IP rate limiting — a wildcard
      // CORS header would invite cross-origin abuse from scripts on arbitrary
      // domains that distribute requests to bypass the IP limit.
      //
      // The origin validation inside the route handler is the primary defence;
      // these headers are the CORS pre-flight layer that stops well-behaved
      // browsers from even sending cross-origin requests.
      {
        source: '/api/demo/:path*',
        headers: [
          {
            key:   'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_URL ?? '*',
          },
          {
            key:   'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },
          {
            key:   'Access-Control-Allow-Headers',
            value: 'Content-Type',
          },
          {
            key:   'Access-Control-Max-Age',
            value: '86400',
          },
        ],
      },
    ]
  },
}

// Wrap with Sentry only when DSN is configured
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  try {
    const { withSentryConfig } = require('@sentry/nextjs')
    module.exports = withSentryConfig(nextConfig, {
      silent:                   true,
      org:                      process.env.SENTRY_ORG,
      project:                  process.env.SENTRY_PROJECT,
      widenClientFileUpload:    true,
      hideSourceMaps:           true,
      disableLogger:            true,
      automaticVercelMonitors:  true,
    })
  } catch {
    module.exports = nextConfig
  }
} else {
  module.exports = nextConfig
}
