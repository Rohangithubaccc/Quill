// TEMPORARY DIAGNOSTIC ROUTE — added to definitively identify why Stripe
// keeps rejecting success_url/cancel_url as "Not a valid URL" despite the
// value appearing correct in the Vercel dashboard. Two prior guesses
// (missing https://, trailing whitespace) were both wrong even after a
// confirmed-fresh deployment, so guessing further isn't productive —
// this reveals the actual raw bytes instead. NEXT_PUBLIC_URL is not a
// secret (it's inlined into every client bundle already), so exposing it
// here briefly is safe. DELETE THIS FILE once the cause is found.
import { NextResponse } from 'next/server'

export async function GET() {
  const raw = process.env.NEXT_PUBLIC_URL
  const charCodes = raw ? Array.from(raw).map(c => c.charCodeAt(0)) : null

  let urlConstructError: string | null = null
  try {
    if (raw) new URL(`${raw}/settings?billing=success`)
  } catch (e: any) {
    urlConstructError = e?.message ?? String(e)
  }

  return NextResponse.json({
    raw,
    length: raw?.length ?? null,
    charCodes,
    urlConstructError,
    trimmedEqualsRaw: raw ? raw.trim() === raw : null,
  })
}
