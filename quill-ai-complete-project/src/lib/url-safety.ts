// ── SSRF prevention: validate URLs before the server fetches them ──────────
//
// Applies anywhere Quill.AI's server makes an HTTP request to a
// user-supplied URL: outbound webhooks, WordPress site_url + header image
// URLs, and any future integration that takes a URL from a workspace
// member. Without this, a workspace member can point the server at
// internal infrastructure (cloud metadata endpoints, the server's own
// loopback interface, other services on the same private network) and
// use Quill.AI's backend as a proxy to reach them.
//
// Approach: resolve the hostname via DNS, reject if ANY resolved address
// falls in a private/loopback/link-local/reserved range. This blocks the
// overwhelming majority of real-world SSRF attempts, including the classic
// cloud-metadata-endpoint attack (169.254.169.254).
//
// Known limitation, stated plainly rather than glossed over: this checks
// the IP at validation time, not at TCP-connect time, so a sufficiently
// deliberate DNS-rebinding attack (hostname resolves to a public IP during
// this check, then to a private IP milliseconds later when fetch() actually
// connects) could theoretically slip through. Fully closing that gap
// requires pinning the resolved IP for the actual connection (a custom
// dispatcher/agent), which is meaningfully more infrastructure than this
// codebase currently has anywhere else. This is a strong practical
// mitigation, not a formal guarantee.

import dns from 'dns'

const dnsLookup = dns.promises.lookup

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  const bits = parseInt(bitsStr, 10)
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask)
}

const PRIVATE_IPV4_RANGES = [
  '0.0.0.0/8',        // "this network"
  '10.0.0.0/8',        // RFC1918 private
  '100.64.0.0/10',     // carrier-grade NAT
  '127.0.0.0/8',        // loopback
  '169.254.0.0/16',    // link-local — includes AWS/GCP/Azure metadata (169.254.169.254)
  '172.16.0.0/12',     // RFC1918 private
  '192.0.0.0/24',      // IETF protocol assignments
  '192.168.0.0/16',    // RFC1918 private
  '198.18.0.0/15',     // benchmarking
  '224.0.0.0/4',        // multicast
  '240.0.0.0/4',        // reserved
]

function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some(cidr => inCidr(ip, cidr))
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1') return true                          // loopback
  if (lower === '::') return true                            // unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true  // unique local (fc00::/7)
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true // link-local (fe80::/10)

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap and check the embedded IPv4.
  // This is a well-known, actively-used SSRF filter bypass technique, and
  // it has TWO different textual forms that both need handling here:
  // dotted-decimal (::ffff:169.254.169.254) and fully-hex
  // (::ffff:a9fe:a9fe — the same address, two 16-bit hex groups). Node's
  // URL parser normalizes IPv6 literals to the hex form before this
  // function ever sees them, so matching only the dotted-decimal pattern
  // (an earlier version of this function did exactly that) silently let
  // the hex form through unblocked — caught by testing this against an
  // actual URL literal, not just a hand-typed dotted-decimal string.
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return isPrivateIpv4(dotted[1])

  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const g1 = parseInt(hex[1], 16)
    const g2 = parseInt(hex[2], 16)
    const ipv4 = [(g1 >> 8) & 0xff, g1 & 0xff, (g2 >> 8) & 0xff, g2 & 0xff].join('.')
    return isPrivateIpv4(ipv4)
  }

  return false
}

function isPrivateOrReservedIp(ip: string, family: number): boolean {
  return family === 4 ? isPrivateIpv4(ip) : isPrivateIpv6(ip)
}

export interface SafeUrlOptions {
  // Only for genuinely local dev/testing use — NEVER true in any code
  // path that could run in production with attacker-supplied input.
  allowLocalhost?: boolean
}

// Validates scheme + resolves DNS + rejects private/reserved targets.
// Returns the parsed URL on success; throws UnsafeUrlError otherwise.
export async function assertSafeUrl(urlString: string, opts: SafeUrlOptions = {}): Promise<URL> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new UnsafeUrlError('Not a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http:// and https:// URLs are allowed')
  }

  const hostname = url.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    if (opts.allowLocalhost) return url
    throw new UnsafeUrlError('URLs pointing at localhost are not allowed')
  }

  // URL.hostname wraps IPv6 literals in brackets (e.g. "[::1]"), but
  // dns.lookup() expects the bare address — without stripping this,
  // lookup() fails on every IPv6 literal (private or not) and the block
  // above would only ever fire via "could not resolve", never via the
  // actual isPrivateIpv6() check below. Harmless for security (fails
  // closed either way) but wrong, and would reject legitimate public
  // IPv6 URLs too.
  const lookupHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname

  let addresses: { address: string; family: number }[]
  try {
    addresses = await dnsLookup(lookupHost, { all: true })
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`)
  }

  for (const { address, family } of addresses) {
    if (isPrivateOrReservedIp(address, family)) {
      throw new UnsafeUrlError(
        `This URL resolves to a private or internal address (${address}) and can't be used here.`,
      )
    }
  }

  return url
}

// Drop-in replacement for fetch() when the URL comes from user input.
// Validates first, then fetches — use this instead of raw fetch() for
// every user-supplied URL the server makes a request to.
//
// Critically, this does NOT just validate the initial URL and hand off to
// fetch()'s default redirect-following — that was the actual gap: assertSafeUrl
// checks the URL the workspace typed in, but fetch()'s default
// `redirect: 'follow'` means a 3xx response from that (now-validated)
// server can point anywhere, including internal infrastructure, and
// fetch() will follow it without any further check. Confirmed live in
// this codebase before this fix: webhooks.ts and
// integrations/wordpress/publish/route.ts both called raw fetch() with no
// redirect override, the latter while sending an Authorization header.
//
// Fetches with `redirect: 'manual'` and walks redirects itself, so every
// hop — not just the first URL — goes through assertSafeUrl(). On a
// cross-origin hop, Authorization and Cookie headers are stripped before
// following, the same protection browsers apply automatically and fetch()
// does not.
const MAX_REDIRECTS = 5

export async function safeFetch(
  urlString: string,
  init?: RequestInit,
  opts?: SafeUrlOptions,
): Promise<Response> {
  let currentUrl = (await assertSafeUrl(urlString, opts)).toString()
  let headers    = new Headers(init?.headers)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, { ...init, headers, redirect: 'manual' })

    // 3xx with a Location header = redirect; anything else is the real
    // response, redirect or not — return it as-is.
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) {
      return res
    }

    if (hop === MAX_REDIRECTS) {
      throw new UnsafeUrlError(`Too many redirects (>${MAX_REDIRECTS})`)
    }

    const previousOrigin = new URL(currentUrl).origin
    // Location can be relative — resolve it against the current URL, same
    // as a browser would.
    const nextUrl = new URL(res.headers.get('location')!, currentUrl)

    // The redirect target is a NEW URL Quill.AI didn't choose — the
    // server that issued it did. Re-validate it exactly like the
    // original, closing the actual gap this function exists to close.
    await assertSafeUrl(nextUrl.toString(), opts)

    if (nextUrl.origin !== previousOrigin) {
      headers = new Headers(headers)
      headers.delete('authorization')
      headers.delete('cookie')
    }

    currentUrl = nextUrl.toString()
  }

  // Unreachable — the loop always returns or throws — but keeps
  // TypeScript satisfied that every path returns a Response.
  throw new UnsafeUrlError('Redirect handling failed unexpectedly')
}
