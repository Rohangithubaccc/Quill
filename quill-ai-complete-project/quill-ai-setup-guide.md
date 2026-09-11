# Quill.AI — Local Setup, From Zero

This walks through everything from an empty folder to `npm run dev`
working on your machine, with real accounts and real API keys. No prior
setup assumed.

**What you're unzipping:** the Quill.AI codebase, current as of this
delivery. It has been through a fresh audit against every prior feature
zip in this project's history, three silent regressions were restored
(brief templates, the Tiptap rich-text editor, and 4 content types that
had all quietly reverted to an earlier snapshot back in May — see "Known
remaining items" below for exactly what that means for you), a
build-breaking bug was fixed (Resend/Stripe clients were instantiated at
module scope, which crashed `next build` if those keys weren't set — they
are now lazy), and BYOK (Bring Your Own Key) has been implemented for the
first time. Verified with a real `next build`, exit code 0, using only
the 5 env vars in Part 4.

---

## Part 0 — Prerequisites

- **Node.js 18.17 or newer** (required by Next.js 14). Check with:
  ```bash
  node --version
  ```
  If you don't have it: [nodejs.org](https://nodejs.org) → LTS version.

- **A code editor** (VS Code, etc.) — optional but recommended for
  editing `.env.local`.

- **No Docker, no local Postgres needed** — Supabase is fully hosted.

---

## Part 1 — Unzip and install

```bash
unzip quill-ai-complete-project.zip -d quill-ai
cd quill-ai
npm install
```

This will take a minute or two. You'll see some `npm audit` warnings at
the end — safe to ignore for now (they're about deprecated sub-dependency
versions, not your code).

Do **not** run `npm run build` or `npm run dev` yet — there's no
`.env.local` file, so it'll crash immediately. That's expected; keep going.

---

## Part 2 — Supabase (the foundation — do this first)

Everything else depends on this. 10 minutes.

1. Go to **[supabase.com](https://supabase.com)** → sign up (free tier is fine).
2. **New Project** → pick a name (e.g. `quill-ai-dev`) → generate a strong
   database password (save it somewhere, though you won't need it directly)
   → pick a region close to you → Create. Takes ~2 minutes to provision.
3. Once ready, go to **Settings → API** (left sidebar). You need three values:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (click "Reveal") → this is `SUPABASE_SERVICE_ROLE_KEY`
     — **this key bypasses all security rules, never expose it client-side
     or commit it anywhere**

4. Run the database migrations. Go to **SQL Editor** (left sidebar) →
   **New query**. Open each file in `supabase/migrations/` **in this exact
   order** and paste + run each one, one at a time:

   ```
   000_validate_functions.sql   (read-only check, safe to skip on first run)
   001_initial_schema.sql
   002_invites_and_fts.sql
   003_billing_and_gdpr.sql
   004_email_tracking.sql
   005_stripe_idempotency.sql
   005b_email_verification_config.sql   (no SQL — read the comments, config only)
   006_parent_id.sql
   007_brand_knowledge.sql
   008_plagiarism_check.sql
   009_comments_enhancement.sql
   010_job_results.sql
   011_published_url_and_waitlist.sql
   012_credits.sql
   013_add_credits_function.sql
   014_image_generation.sql
   015_webhooks.sql
   016_white_label.sql
   017_missing_tables_and_storage.sql
   018_byok_anthropic_key.sql
   019_campaigns.sql
   020_knowledge_base.sql
   021_injection_flagging.sql
   022_malware_scan.sql
   023_ai_intelligence.sql
   024_dam.sql
   025_approval_chains.sql
   ```

   Each one should show "Success. No rows returned" (or similar). If any
   one errors, stop and fix it before moving to the next — they build on
   each other in order.

5. **Enable email confirmation** (`005b`'s manual step — SQL can't do this):
   - **Authentication → Providers → Email** → toggle **"Confirm email"** ON → Save
   - **Authentication → URL Configuration**:
     - Site URL: `http://localhost:3000`
     - Redirect URLs: add `http://localhost:3000/api/auth/callback`

6. **(Optional) Google sign-in button** — the login page has a "Continue
   with Google" button. Skip this for now if you just want email/password
   working; the app functions fully without it.
   - **Authentication → Providers → Google** → toggle on, follow Supabase's
     prompts to create a Google OAuth client.

7. **Confirm the storage bucket is public** (migration 017 does this via
   SQL, but double-check): **Storage** (left sidebar) → you should see a
   `brand-assets` bucket → click it → confirm it's marked **Public**.

---

## Part 3 — Anthropic (required — this is what actually generates content)

1. **[console.anthropic.com](https://console.anthropic.com)** → sign up.
2. **Settings → API Keys → Create Key**. Copy it — this is `ANTHROPIC_API_KEY`.
3. Add a small amount of credit (Anthropic requires prepaid credit —
   $5 is enough to test extensively; content generation costs fractions of a cent per call).

---

## Part 4 — Minimum `.env.local` to boot the app

Copy the example file:
```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in **just these four** for now — everything
else in the file is optional and the app degrades gracefully without it
(you'll see this yourself — buttons for missing features return clear
error messages instead of crashing):

```bash
NEXT_PUBLIC_SUPABASE_URL=<from Part 2>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Part 2>
SUPABASE_SERVICE_ROLE_KEY=<from Part 2>
ANTHROPIC_API_KEY=<from Part 3>
NEXT_PUBLIC_URL=http://localhost:3000
```

Also generate these two now (they're cheap and used everywhere):
```bash
openssl rand -hex 32   # run this once, use the output for ENCRYPTION_KEY
openssl rand -hex 32   # run this again, use the output for CRON_SECRET
```

---

## Part 5 — Run it

```bash
npm run dev
```

Open **http://localhost:3000**. You should see the marketing landing page.

Try signing up (`/signup`). Since email confirmation is on, check the
inbox of whatever email you used — Supabase sends the confirmation email
itself using its own built-in email service on the free tier (no Resend
needed yet for this specific flow).

Once confirmed, log in, create a workspace, and try the **Generator** —
this is the point where you find out if `ANTHROPIC_API_KEY` is working.
A successful generation confirms your entire core stack (Supabase + Auth +
Anthropic) is wired correctly.

**What won't work yet, and why that's expected:**
- Billing / upgrade buttons → no Stripe keys yet (Part 6)
- Email invites, approval notifications → no Resend key yet (Part 7)
- Header image generation → no OpenAI key yet (optional, Part 8)
- Background jobs (bulk repurpose, async images) → need the Inngest dev
  server running (Part 9)

None of these block you from testing the core product.

---

## Part 6 — Stripe (add when you want to test billing)

1. **[stripe.com](https://stripe.com)** → sign up → you'll land in
   **Test mode** by default (toggle top-right confirms this — stay in test
   mode for local dev, always).
2. **Developers → API keys** → copy the **Secret key** → `STRIPE_SECRET_KEY`.
3. Create your products: **Product catalog → Add product**, one each for
   Starter, Growth, Agency:
   - Recurring price, monthly billing
   - Copy each price's ID (starts `price_...`) into **both**
     `STRIPE_STARTER_PRICE_ID` and `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID`
     in `.env.local` (same value, both variables — see the comment in
     `.env.local.example` for why both are needed)
4. Create 3 more **one-time** (not recurring) prices for the credit
   top-up packs → same pattern for `STRIPE_ADDON_SMALL/MEDIUM/LARGE_PRICE_ID`.
5. **Webhooks** (needed for subscriptions to actually update your database):
   Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then:
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   This prints a `whsec_...` value — that's `STRIPE_WEBHOOK_SECRET`. Keep
   this terminal running whenever you're testing billing locally.
6. Test card number for checkout: `4242 4242 4242 4242`, any future
   expiry, any CVC.
7. **Enable the Customer Portal**: Stripe Dashboard → Settings → Billing →
   Customer Portal → turn it on (needed for the "Manage Subscription" button).

---

## Part 7 — Resend (add when you want emails to actually send)

1. **[resend.com](https://resend.com)** → sign up → free tier is 3,000 emails/month.
2. **API Keys → Create API Key** → `RESEND_API_KEY`.
3. For `EMAIL_FROM`: Resend's free tier lets you send from
   `onboarding@resend.dev` immediately with no domain setup, which is
   fine for local testing. For real sending later, you'd verify your own
   domain under **Domains**.

---

## Part 8 — Optional services (add only if you want to test that specific feature)

Each of these is genuinely optional — skip any you don't need right now.

| Service | Unlocks | Sign up |
|---|---|---|
| **OpenAI** | DALL-E 3 header images | [platform.openai.com](https://platform.openai.com) |
| **Upstash Redis** | Rate limiting (app works without it, just unprotected) | [upstash.com](https://upstash.com) — free tier |
| **Buffer** | Social scheduling publish | [buffer.com/developers](https://buffer.com/developers) |
| **LinkedIn** | Direct LinkedIn publish | [developer.linkedin.com](https://developer.linkedin.com) |
| **Google Cloud (GSC)** | Search Console ranking data | [console.cloud.google.com](https://console.cloud.google.com) |
| **Originality.ai** | Plagiarism/AI-detection checks | [originality.ai](https://originality.ai) |
| **News API** | Real trend data in Analyzer (Google Trends + Reddit work without it) | [newsapi.org](https://newsapi.org) — free tier |
| **Sentry** | Error monitoring | [sentry.io](https://sentry.io) |
| **PostHog** | Product analytics | [posthog.com](https://posthog.com) |

---

## Part 9 — Inngest (background jobs — needed for async image gen + bulk repurpose)

For local development, you do **not** need an Inngest account. Run the
dev server in a second terminal, alongside `npm run dev`:

```bash
npx inngest-cli@latest dev
```

This starts a local Inngest dashboard at **http://localhost:8288** where
you can watch background jobs (image generation, bulk repurpose, webhook
retries) execute and debug them in real time. No env vars needed for this
local mode.

For production later, install the [Inngest Vercel integration](https://www.inngest.com/docs/deploy/vercel),
which sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` automatically.

---

## Security pass

A real audit, not a checklist rundown — every item below was either
reproduced (the bug existed, confirmed with a test, then fixed) or
explicitly tested to confirm it's actually sound. Organized by what's
fixed vs. what's a residual risk worth knowing about.

**Fixed — SSRF (server-side request forgery):**
- Outbound webhooks (`/api/webhooks`) allowed `http://localhost` "for
  testing" — in production, "localhost" means the production server's own
  loopback interface, not a developer's laptop. Removed; test with a
  tunnel (ngrok) instead. Neither the create route nor any private-IP
  range (RFC1918, link-local/cloud-metadata, etc.) was checked at all
  before this pass.
- WordPress publish (`headerImageUrl` from the request body, `site_url`
  from stored integration config) fetched attacker-influenceable URLs
  server-side with zero validation.
- **The WordPress "Connect" form in Settings was silently broken** — it
  calls `PUT /api/integrations/wordpress/publish` but only a `POST`
  handler existed, so saving credentials would 405. Found as a side
  effect of checking where `site_url` gets validated; added the missing
  `PUT` handler (with the same SSRF validation at save time).
- New shared module (`src/lib/url-safety.ts`): resolves the hostname via
  DNS and rejects private/loopback/link-local/reserved ranges, for both
  IPv4 and IPv6 — including IPv4-mapped IPv6 addresses
  (`::ffff:169.254.169.254`), a known SSRF-filter bypass technique. Tested
  against ~15 real attack patterns including the cloud-metadata-endpoint
  case; **caught and fixed a bypass in my own first implementation** —
  `URL.hostname` normalizes IPv6 literals into fully-hex form before this
  code ever sees them, and an initial version of the mapped-IPv4-unwrap
  regex only matched the dotted-decimal textual form, letting the hex
  form through unblocked. Fixed to handle both forms; retested to confirm.
  Applied at both creation/save time and again at actual use/delivery
  time (defense in depth against DNS changing after the URL was saved).
  Stated plainly: this checks the resolved IP at validation time, not at
  TCP-connect time, so a sufficiently deliberate DNS-rebinding attack
  could in principle still slip through — a formal guarantee would need
  to pin the resolved IP for the actual connection, which is more
  infrastructure than anywhere else in this codebase has. This is a
  strong practical mitigation, not a proof.

**Fixed — rate limiting was silently broken for anyone skipping the
"optional" Upstash setup:**
- Confirmed by testing directly, not assumed: `@upstash/redis` throws a
  `TypeError` the moment `.limit()` is actually called without a
  configured `url`/`token` — it doesn't fail at import time, so this
  wasn't caught by any of the `next build` checks earlier in this
  delivery. Four routes (`ai/generate` — the core content generation
  feature — plus `auth/resend-verification`, `demo/generate`, `track`)
  called `.limit()` directly with no guard, meaning **all four would 500
  on every single request** for anyone who followed this guide's own
  "Upstash is optional" framing and skipped it. A fifth route
  (`ai/image`) had already solved this correctly with a lazy-init +
  null-check pattern — used that as the template.
- New shared module (`src/lib/rate-limit.ts`) fixes this for good: fails
  open (allows the request) both when Redis isn't configured at all and
  when a configured Redis call fails at runtime (bad credentials,
  Upstash outage) — a broken rate limiter should never become an outage
  for legitimate traffic. All 5 previous call sites migrated to it.
- Worth knowing, not silently decided: failing open means a workspace
  without Upstash configured has **no meaningful rate limiting at all**
  on these routes. For `ai/generate` that's a lesser concern (still
  behind auth + credits). For the public, unauthenticated `/try` demo and
  `resend-verification` routes specifically, their entire purpose is
  abuse/cost/spam prevention — if you're keeping the public demo live,
  treat `UPSTASH_REDIS_REST_URL`/`TOKEN` as effectively required, not
  optional, despite Part 8's framing.
- Rate limiting added to routes that had none at all: `auth/signup` (10/hr
  per IP — was fully open to automated mass account creation),
  `workspace/invites` (20/hr per workspace — was fully open to spamming
  invite emails to arbitrary addresses, a Resend-account-reputation
  risk), `knowledge-base/upload` (10/hr per workspace — each upload
  triggers a real OpenAI embeddings cost with no credit-system coverage),
  `ai/humanize` and `ai/repurpose` (per-user — both bypass the credit
  system entirely for BYOK workspaces, so were completely unthrottled for
  any workspace using their own Anthropic key).

**Fixed — file upload validation was extension/MIME-type only (both
client-supplied, both trivially spoofed):**
- Added magic-byte signature verification for Knowledge Base uploads
  (PDF/DOCX) and logo uploads (PNG/JPEG/WebP) — confirms the file's
  actual bytes match its claimed type before storing or processing it.
  Tested against real files and spoofing attempts (a PDF renamed to
  claim `.docx`, a Windows executable header claiming to be a PDF) —
  all correctly rejected; real files of each type correctly accepted.
- **Removed SVG from allowed logo types.** SVG is XML and can embed
  executable `<script>` tags — the logo bucket is public, so a malicious
  SVG opened at its direct storage URL (not just rendered inside an
  `<img>` tag elsewhere, where browsers don't execute embedded SVG
  scripts — the raw URL specifically) would run as real stored XSS.
  PNG/JPEG/WebP cover every realistic logo use case without that risk
  category existing at all — safer than hand-rolling SVG sanitization,
  which is easy to get subtly wrong.
- Known residual gap, not fixed: none of this is malware/antivirus
  scanning — a well-formed PDF or DOCX that happens to be malicious in
  some other way (embedded exploit targeting a PDF reader, a DOCX zip
  bomb) isn't caught by a signature check. That requires a third-party
  scanning service (e.g. VirusTotal API, ClamAV) this codebase doesn't
  have anywhere.

**Fixed — encryption key validation:**
- `ENCRYPTION_KEY` parsing silently turned non-hex characters into zero
  bytes (`parseInt(..., 16) === NaN` implicitly becoming `0`) rather than
  erroring — confirmed with a direct test that a malformed key (anything
  that isn't the `openssl rand -hex 32` format this guide instructs)
  could produce a weak, predictable, mostly-zero AES key with **no error
  at all**, silently weakening encryption for every WordPress/Buffer/
  LinkedIn/GSC/BYOK credential in the database. Now validated explicitly
  — a malformed key throws a clear, actionable error immediately instead
  of degrading security silently.

**Reviewed, no changes needed:**
- XSS: no `dangerouslySetInnerHTML` anywhere in the codebase (app or
  email templates) — searched directly, zero matches. The Tiptap editor
  is schema-constrained (StarterKit + Placeholder only), so it can't
  render injected script content from generated text either.
- CSRF: session cookies default to `SameSite=Lax` (via `@supabase/ssr`,
  not overridden anywhere), and the custom `workspace_id` cookie
  explicitly sets it too. Combined with every state-changing route
  requiring a JSON body (which cross-origin form submissions can't send
  without a CORS preflight Next.js doesn't grant), this is adequate
  baseline protection without adding a separate CSRF token system.
- SQL injection: the Supabase JS client is used throughout with
  parameterized `.eq()`/`.insert()`/etc. calls, never raw string-
  concatenated SQL — the one place raw SQL exists is the migration files
  themselves, which aren't attacker-reachable.
- Tenant isolation / RBAC: this is what the campaigns and knowledge-base
  local-Postgres testing earlier in this delivery already verified
  directly (real RLS enforcement, real cross-workspace isolation, real
  role-gated deletes) — not re-covered here since it was tested, not
  assumed, when each feature was built.

## Pre-launch risk audit

Requested directly: "run this, find the mistakes/errors/risks that will
cause issues for real customers." This went beyond `tsc`/`next build`
(which catch compile errors, not business-logic or concurrency bugs) —
concurrency testing with real parallel database connections, a full
lint pass (never run on this project before), and a systematic search
for every instance of a bug pattern once one was found. Ordered by
severity.

### 🔴 Critical — found, fixed, and empirically proven

**Every credit-charging route had a race condition that silently
undercounts usage under concurrent load.** `ai/generate`, `ai/repurpose`,
`ai/image`, `ai/bulk-repurpose`, and `content/[id]/plagiarism` all read
`credits_remaining` into a JS variable, subtracted the cost, and wrote
the computed value back — a classic read-modify-write race. Two
concurrent requests to the same workspace (two team members generating
at once, or any retry) both read the same starting balance and both
write the same under-decremented result; the second deduction is
silently lost.

**This wasn't theoretical — I proved it with real concurrent database
connections.** Seeded two workspaces with 1,000 credits each, fired 50
truly concurrent 5-credit deductions (250 credits expected) at each: the
old pattern left **970 remaining instead of 750 — 44 of 50 deductions
were silently lost**, a workspace effectively getting 88% of that usage
for free. The fix (atomic conditional `UPDATE ... WHERE credits_remaining
>= amount`, migration `026_atomic_credits.sql`) got exactly 750, every
time.

**The irony:** migration `013_add_credits_function.sql` already solved
this exact problem correctly, with a code comment explaining the race in
detail — but only for *adding* credits (Stripe webhooks, monthly resets).
The same fix was never applied to *deducting* them, which is the
direction that actually costs real money. All 5 routes now use the new
atomic `deduct_credits()` function; the DAM's `used_count` display
counter had the identical (much lower-stakes) pattern and was fixed the
same way.

### 🔴 Critical — not a bug I introduced, but broken today

**The GDPR/DPDP data export and account deletion buttons in Settings
don't work — the routes they call don't exist.** Settings already has
UI that calls `GET /api/gdpr/export` and `DELETE /api/gdpr/delete`, and
displays the text "GDPR / DPDP Act 2023 compliant" to every user. Neither
route exists anywhere in the codebase — they were listed in the original
Phase 7 roadmap but never built. Right now, any real customer who clicks
"Download my data" or "Delete my account" gets a broken request, and the
product is actively displaying a compliance claim that isn't true. This
is worse than a missing feature: it's a live, customer-facing broken
button plus a false claim, and for EU/UK or India-based customers
specifically, a real legal exposure (GDPR/DPDP require an actual
mechanism for data deletion on request — "we have a button that 404s"
doesn't satisfy that). **Not fixed in this pass** — flagging clearly
rather than either quietly building a rushed version or leaving it
undiscovered. This needs its own scoped implementation (export needs to
walk every table with a workspace_id or user_id; deletion needs to
decide soft-delete-and-anonymize vs. hard-delete, and needs to handle
the active Stripe subscription).

### 🟡 Medium

- **Two people approving the same content piece at the same approval
  stage simultaneously** would both succeed and both write an audit-trail
  entry, rather than the second one correctly failing as stale (the route
  read `current_stage_index` once and reused it, the same class of issue
  as the credits bug, but consequence is a duplicate audit-log line, not
  lost money or corrupted state — both concurrent approvals compute the
  same correct next stage). Fixed with an optimistic-concurrency guard
  (`.eq('current_stage_index', ...)` on the update, checking whether a
  row actually matched) in both the advance and reject routes.
- **No per-workspace storage quota anywhere in the app**, for any plan
  tier. DAM alone allows up to 200MB/file, 60 uploads/hour/workspace —
  a sustained heavy (or malicious) workspace could run real Supabase
  Storage costs with zero cap tied to their subscription price. Not a
  bug, a missing guardrail — worth deciding on a per-plan quota before
  this is customer-facing at any real scale.

### 🟢 Low — cosmetic, not customer-facing

- **This project has never had ESLint actually configured** — `eslint`/
  `eslint-config-next` are in `package.json`, but no `.eslintrc` exists,
  so `npm run lint` has never caught anything, ever. Set one up
  (`next/core-web-vitals`) to actually run it for this audit: 14
  `no-unescaped-entities` errors (raw quotes/apostrophes in JSX text —
  renders completely fine, just not strict-mode-clean) and 13
  `react-hooks/exhaustive-deps` warnings, spread across files both
  touched and untouched this session (i.e., pre-existing, not introduced
  here). Spot-checked the two most plausible-looking `exhaustive-deps`
  warnings (Topbar's auth listener, Settings' mount-only fetch effect) —
  both are intentional run-once-on-mount patterns, not real staleness
  bugs. Didn't spot-check all 13; the ones checked were false positives,
  but that's not a guarantee for the rest.
- Config file itself (`.eslintrc.json`) isn't included in this delivery —
  add it if you want `npm run lint` to actually do anything going forward
  (`{ "extends": "next/core-web-vitals" }` is enough to start).



Three features built together, all genuinely tested against a real
Postgres database (migrations, RLS tenant isolation, and the actual
business logic — not just `tsc`/`next build`), same standard as
everything else in this delivery.

**AI Intelligence Layer** (migration `023_ai_intelligence.sql`):
- **Brand consistency scoring** and **engagement prediction** now run in
  the same Haiku call that already did quality scoring — one extra
  request per generation, not three. Brand consistency only scores when
  the workspace actually has brand voice/knowledge configured. Engagement
  prediction is grounded in the workspace's own historical average
  engagement for that content type where at least 3 published pieces
  exist, falling back to general heuristics otherwise. Both show as
  badges next to the existing Quality badge in the generator.
- **Best Times to Post** (`/api/analytics/best-times`, surfaced on the
  Performance page): aggregates the workspace's own `calendar_events` +
  `content_pieces.engagement_score` history into day/time-window
  buckets, requires 2+ posts per bucket before treating it as a real
  pattern (not single-post noise), and falls back to general best-
  practice guidance — clearly labeled as such — for workspaces without
  enough history yet. The bucketing/ranking logic is unit-tested against
  synthetic data with a known correct answer, and the underlying SQL
  join was verified against real seeded data in Postgres directly (the
  Supabase-JS embedded-resource filter syntax itself — `!inner` with
  `.eq('table.column', ...)` — is the documented standard pattern but
  wasn't testable end-to-end without a running PostgREST instance; this
  is worth a smoke test after deploying).

**Digital Asset Management** (migration `024_dam.sql`, new `/assets`
page): searchable, folder-organized library for images and videos,
separate from the single workspace logo and from Knowledge Base
documents (different purposes — DAM is for reuse in published content,
Knowledge Base is for the AI to read). Drag-and-drop upload, magic-byte
signature verification (same reasoning as the Knowledge Base/logo
uploads — extended here to also cover MP4/WebM/MOV/GIF), full-text
search by name, tag filtering, move/rename, and a `used_count` that
increments when an asset is attached to a content piece
(`content_piece_assets` join table) — surfaces which assets are actually
getting reused, the whole point of a DAM over one-off per-piece uploads.
RLS tenant isolation re-verified with real cross-workspace seeded data,
same as every other table in this project.

**Multi-stage approval chains + audit history** (migration
`025_approval_chains.sql`): workspaces can now configure an ordered
chain of named stages (Settings → Approval Workflow), each requiring a
minimum role to approve — e.g. Writer Review (editor+) → Brand Review
(admin+) → Legal Sign-off (owner only). **Backward compatible by
design** — a workspace with zero configured stages keeps using the
existing simple review → approved flow exactly as before; the chain only
activates for workspaces that explicitly define one. Every
approve/reject is logged to `approval_history` with the actor, stage,
timestamp, and (for rejections) a required note — visible as a timeline
on the Review page. Role-gating (can this person approve at this stage?)
was unit-tested against all 9 realistic role/requirement combinations,
then the full 3-stage state machine — advance, advance, finalize — was
run against real seeded Postgres data end to end, followed by a separate
rejection-path test and a tenant-isolation check. New webhook events:
`content.rejected`, `content.stage_advanced`.

**A real, previously-existing bug found via this testing, unrelated to
any of the three features above:** `needs_revision` has been a
documented, Zod-validated status value since migration
`009_comments_enhancement.sql` — but the database's own CHECK constraint
was never actually updated to allow it. Confirmed by running the actual
rejection UPDATE against a real Postgres database: it failed outright
with a constraint violation. This means the existing single-review-gate
"Needs Revision" button (independent of anything built in this pass) has
been silently broken since migration 009 — however long ago that was —
for any workspace not using the new approval chains. Fixed in migration
`025_approval_chains.sql` (Part 0) and reverified end to end.


- **Prompt-injection hardening.** Every user- or third-party-influenceable
  field that flows into a Claude prompt — brief keyword/audience,
  brand voice, structured brand knowledge, retrieved knowledge-base
  excerpts, repurpose/humanize source content, and even the Reddit
  posts/news headlines the Analyzer pulls in from the open internet — is
  now wrapped in explicit delimiters (e.g. `<company_knowledge>`,
  `<source_content>`) with an instruction-hierarchy statement up front:
  content inside those tags is reference data, never instructions, even
  if it's phrased as one. This is a real improvement over the previous
  bare string interpolation (some fields, like `keyword`/`audience`, had
  *no* delimiting at all before; `knowledgeChunks` opened a section but
  never closed it, so injected content could visually "escape" it) — but
  stated plainly: this is industry-standard practical mitigation, not a
  solved problem. A sufficiently sophisticated attack can still work
  around delimiting in principle. Layered with a second, independent
  check: uploaded Knowledge Base documents are scanned for common,
  unsophisticated injection patterns (`src/lib/prompt-injection.ts`) at
  processing time — flagged for human visibility in Settings, never
  auto-blocked (tested against real true-positive, true-negative, and
  expected-false-positive cases; a legitimate security-training document
  quoting an injection phrase will and should still flag — that's a
  feature of visibility-only, not a bug).
- **Malware scanning on Knowledge Base uploads (optional — VirusTotal).**
  New `VIRUSTOTAL_API_KEY` env var (Part 8, free tier: 500/day). Hash-
  lookup first (instant), falls back to upload-and-poll for files
  VirusTotal hasn't seen before, bounded to ~1 minute of polling before
  giving up and proceeding unscanned rather than holding the upload
  indefinitely. Blocks the document outright on an actual positive
  detection; fails open (proceeds, marked "unscanned") on any
  infrastructure problem — a scanning outage degrading to "no scan" is
  the right failure direction, not blocking every upload. **Honestly
  scoped:** the decision logic (verdict thresholds, including a
  2+-engine minimum for "suspicious" findings to avoid blocking on
  single-engine noise) is unit-tested against realistic response shapes,
  and the multipart upload construction was verified to build correctly.
  The actual live calls to VirusTotal's API were **not** testable from
  the environment this was built in — no network path to
  `virustotal.com` there, the same category of limitation as the OpenAI
  embeddings call earlier in this guide. Test an actual upload against a
  real `VIRUSTOTAL_API_KEY` before relying on this. Logo uploads (PNG/
  JPEG/WebP) are not scanned — lower risk given the format restriction
  and magic-byte check already in place, and out of scope for this pass.

**Not addressed — real gaps, flagging rather than pretending otherwise:**
- No SOC2/audit-logging/SSO/SAML/SCIM — out of scope for this pass by
  design (see the earlier product-strategy discussion: these are
  buy-don't-build for a company this size, and premature before a
  specific enterprise prospect asks).
- `next@14.2.18` has a known security advisory
  (nextjs.org/blog/security-update-2025-12-11) — worth upgrading before
  launch; not attempted here since a major-version bump risks its own
  regressions and deserves its own dedicated pass.


**Fixed in this delivery** (previously silent regressions — flagging so
you know they were real, not paranoia):
- `generator/page.tsx` had reverted to an April snapshot at some point
  during Phase 4 and stayed that way through every later zip, including
  the one previously labeled "complete." Restored: the brief-templates
  picker, the Tiptap rich-text editor (was in `package.json` but no
  component actually used it — output was a read-only `<div>`), and 4
  content types (YouTube Script, TikTok/Reels, Podcast Episode Outline,
  Webinar Script) that `credits.ts` was still pricing but the dropdown
  didn't offer.
- `performance/page.tsx` had zero GSC (Google Search Console) UI even
  though the backend routes (`connect`/`callback`/`data`) were intact —
  restored the rankings panel and connect CTA.
- Resend and Stripe clients were instantiated at module scope
  (`new Resend(process.env.RESEND_API_KEY!)`), which crashed
  `next build` the moment those env vars were absent — including with
  exactly the "minimum" env vars this guide recommends in Part 4. Now
  lazy, matching the pattern already used for Upstash Redis.
- **`001_initial_schema.sql` could never actually run on a fresh Supabase
  project.** The two RLS helper functions (`is_workspace_member`,
  `is_workspace_owner_or_admin`) were defined at the top of the file,
  referencing `workspace_members` — but that table wasn't created until
  50 lines later in the same script. Postgres `LANGUAGE sql` functions
  resolve against the catalog at creation time, so this fails immediately
  on any genuinely empty database. Confirmed with an isolated repro
  against real Postgres, then reordered the file and reran all 20
  migrations end-to-end on a fresh database to confirm the fix. This
  would have blocked step 4 of Part 2 for anyone following this guide
  from a brand-new Supabase project — if you hit "relation
  workspace_members does not exist" on migration 001 with an earlier
  copy of this file, this is why.
- `.env.local.example` and `.gitignore` were silently missing from every
  zip delivered this session (including earlier in this conversation) —
  a `cp -r dir/* dest/` during my own working setup doesn't match hidden
  dotfiles in bash, so both got dropped without erroring. `.gitignore`
  didn't exist in this project at all before now, which also means the
  "`.env.local` is already in `.gitignore`" claim in Part 10 below was
  false until this fix. Both are back and verified present in this zip.

**New in this delivery, not yet run against a live Anthropic key:**
- **AI Knowledge Base.** Upload PDF/DOCX/TXT documents (Settings →
  Knowledge Base, 20MB max) — they're chunked, embedded (OpenAI
  `text-embedding-3-small`, reuses the `OPENAI_API_KEY` already required
  for DALL-E), and stored in Postgres via pgvector. At generation time,
  the top 5 most relevant chunks are retrieved and injected into the
  prompt automatically. Requires **migration `020_knowledge_base.sql`**
  and an Inngest job (`processKnowledgeDocument`) for the async
  extract → chunk → embed pipeline. **Actually tested, not just
  compiled:** generated real PDF/DOCX/TXT files and ran the exact
  `extractText()`/`chunkText()` functions against them, and separately
  verified the pgvector retrieval function's similarity ranking and
  tenant isolation against seeded data in a local Postgres instance. The
  one piece that couldn't be tested from this environment is the live
  OpenAI embeddings API call itself — no network path to `api.openai.com`
  from here, same category of limitation as BYOK below. **Worth knowing:**
  building this surfaced that the popular `pdf-parse` npm package bundles
  a frozen 2018-era PDF.js fork that failed to parse multiple independently-
  valid PDFs (confirmed with `qpdf --check`) during testing. Swapped to
  `pdfjs-dist` (the actual maintained library) instead, which handled the
  same files correctly. If you see `pdf-parse` mentioned anywhere else in
  older notes from this project, that's why it's not in this build.
- **Campaigns.** Groups multiple content pieces under one initiative
  (e.g. "Diwali 2026", "Series A Announcement") with a rollup of piece
  count, status breakdown, and average engagement. New nav item, list
  page, and detail page. Generate content directly into a campaign via
  `/generator?campaign=<id>`, or attach existing pieces from the campaign
  page. Requires **migration `019_campaigns.sql`**. This one has been
  exercised less than everything else in this delivery — worth clicking
  through create → generate-into-it → add-existing → delete once before
  relying on it with real data.
- **BYOK (Bring Your Own Key).** Workspace owners can add their own
  Anthropic API key in Settings → Anthropic API Key. When connected,
  `ai/generate`, `ai/humanize`, `ai/repurpose`, `analyzer/trends`, the
  bulk-repurpose background job, all resolve their Anthropic client
  per-workspace and skip Quill.AI credit deduction for that workspace
  (still increments `usage_count` for analytics). Falls back to the
  platform key automatically if the workspace's key fails to decrypt or
  hasn't been added, and surfaces the failure reason in Settings.
  Requires running **migration `018_byok_anthropic_key.sql`** (now
  included in the ordered list in Part 2 above — make sure you actually
  ran it if you're updating an existing Supabase project rather than
  starting fresh). No new env vars: it reuses `ENCRYPTION_KEY`, the same
  AES-256-GCM key already used for WordPress/Buffer/LinkedIn/GSC
  credentials.
- This has been verified with `next build` and `tsc --noEmit`, but **not**
  against a real Anthropic key end-to-end (key validation ping, actual
  generation on a customer key, decrypt-failure fallback). Test that path
  before shipping it to real customers.

**Not yet addressed** (pre-existing, unrelated to this pass):
- `next@14.2.18` has a known security advisory
  (nextjs.org/blog/security-update-2025-12-11) — worth upgrading before
  launch.
- Team collaboration (Phase 3) and the Inngest bulk-job-results migration
  were flagged as partially packaged in earlier sessions and weren't
  re-verified here — this pass was scoped to the three items above.

---

## Load-testing under concurrent real traffic

Fourth item this session, following the same three fixes above
(Campaigns date validation, calendar auto-schedule duplicate-event guard,
team-invite seat-claim race — migration `034`). No live Supabase or
Vercel Cron infrastructure was available to hit over real HTTP, so this
was done the same way the credits/storage/seats races were originally
proven: a genuinely fresh local Postgres 16 instance (with pgvector and
Supabase's `auth`/`storage` schemas and roles emulated) and real
concurrent connections racing the actual SQL your routes call —
reasoning-only static review had already missed all three bugs below
once each this session, so this was empirical or nothing.

### 🔴 Found and fixed: double storage-release in the content-purge cron

`/api/cron/purge-deleted-content` queried due rows with a plain
`SELECT`, then per workspace: listed Storage files, computed
`bytesReleased` from whatever hadn't been removed yet, called
`release_storage()`, and only *then* deleted the rows. Two real
concurrent invocations against a seeded workspace
(`storage_used_bytes = 5,000,000`, 500,000 bytes of due content) both
listed the same not-yet-removed files, both computed the same
`bytesReleased`, and both called `release_storage()` with it — final
balance landed at `4,000,000`, not the correct `4,500,000`. The DELETE
itself was never the unsafe part (Postgres `DELETE ... WHERE id IN
(...)` is naturally idempotent — the loser just matches 0 rows, no
error), which is exactly why an earlier look at this same cron produced
a confusing "both invocations reported success" result with no obvious
corruption. The corruption is silent and one-directional: a workspace's
tracked usage only ever drifts *below* its real usage, quietly expanding
its effective quota — no error, no user-visible symptom, until something
else stops matching reality.

Fixed with the same shape as every other atomicity fix this project has
needed: `claim_content_for_purge()` (migration `035`) atomically claims
rows via `UPDATE ... WHERE purge_claimed_at IS NULL OR stale RETURNING`
*before* anything storage-related is computed, so `bytesReleased` can
never be derived twice for the same bytes. Claims self-expire after 10
minutes, so a workspace where Storage cleanup throws gets retried on the
next run instead of leaking storage forever. Re-ran the identical
two-invocation race against the patched function: one invocation claimed
all 5 rows, the other claimed 0, and `storage_used_bytes` landed at the
correct `4,500,000`.

### 🔴 Found and fixed: duplicate notification emails from three cron/route call sites

`linkedin-token-reminder`, and both branches of `trial-reminder`
(trial-ending and usage-80%), each did a plain "have we already sent
this?" `SELECT` against `sent_emails`, sent the email, then `INSERT`ed a
row to remember it — the same check-then-act shape already found and
fixed this session for credits, storage, and seats. Reproduced for the
LinkedIn cron with two real concurrent invocations: both connections
evaluated the "already sent this week?" check as empty before either
had inserted, so both proceeded — final row count for that
`(workspace, email_type)` key was 2, meaning the customer would get the
reminder twice.

A table-wide `UNIQUE(workspace_id, email_type)` constraint doesn't work
here — `usage_80pct` is expected to legitimately recur every month, and
a permanent constraint would silently stop it from ever sending again
after the first month, since the three call sites have three different
dedup windows (rolling 7 days, calendar day, calendar month). Fixed with
`claim_email_send()` (migration `036`): a transaction-scoped advisory
lock keyed on `(workspace_id, email_type)` serializes concurrent claims
without needing a schema constraint, and the check + log-insert happen
inside one atomic RPC call — this matters specifically because Supabase
is PostgREST over HTTP, so a lock taken in one `.rpc()` call and
released in a separate later call has no guarantee of hitting the same
underlying connection. All three call sites now claim before sending and
release the claim (delete the row) if the actual `resend.emails.send()`
call throws, so a transient send failure doesn't permanently mark a
reminder as sent. Re-ran the identical race against the patched
function: exactly one non-null claim between the two concurrent calls.
Stress-tested at 20 concurrent claims for the same key — still exactly
one winner, one row.

### 🟡 Found and fixed (code-level, not separately load-tested): duplicate "domain is live" email

`verify-domains` sends the activation email unconditionally whenever
*its own* Vercel API check comes back verified, with no atomic claim on
the status transition — the same root cause as the two bugs above, just
without a `sent_emails` row to race on. Two overlapping invocations
checking the same domain could both see `isVerified = true` independently
and both fire the notification. Fixed by making the status `UPDATE`
itself the claim — scoped to `.in('status', ['pending', 'verifying'])`
with `.select().maybeSingle()` read back, so only the invocation whose
`UPDATE` actually flips the row (Postgres serializes concurrent updates
to the same row; the loser's `WHERE` re-evaluates post-commit and no
longer matches) sends the notification. This is the identical
conditional-update pattern already used by the approval-chain
optimistic-concurrency guard elsewhere in this codebase, applied here for
the first time — not separately reproduced with a live two-connection
race the way the two bugs above were, since there's no stateful table
row to seed and race in isolation the same way; confidence here rests on
the code pattern being proven correct in this exact codebase already,
not on a fresh empirical repro.

### ✅ Confirmed safe (checked, not just assumed)

`purge-deleted-workspaces` — no separate release step, since the whole
workspace row (and everything that cascades from it, including its
`storage_used_bytes`) disappears atomically; verified with a real
concurrent double-delete test (first call deletes the row, second
matches 0 rows, no error, no crash). `reset-usage`, `cleanup-stripe-events`,
and `aggregate-engagement` are all naturally idempotent — plain `SET`-to-
absolute-value or range-`DELETE` operations with no read-modify-write
step, safe under any concurrency by construction, not by luck.

### Mixed concurrent load — 450 simultaneous calls across every atomic function

Beyond re-testing each fix in isolation, one combined stress run fired
450 real concurrent connections at once — `deduct_credits`,
`reserve_storage`, `claim_seat_and_create_invite`, and `claim_email_send`
— all mixed together against 5 seeded workspaces simultaneously, closer
to what genuine concurrent production traffic actually looks like than
testing one function at a time. Zero errors, zero deadlocks, ~21 seconds
wall time. Every final number checked out exactly against hand-computed
expectations: credits `1,000 → 800` per workspace (40 × 5-credit
deductions), storage `1,000,000,000 → 1,040,000,000` per workspace
(40 × 1MB reservations), seats exactly 4 of 6 concurrent invite attempts
succeeding per workspace against a limit of 5 (1 owner + 4 pending, 2
correctly rejected), and email dedup exactly 1 of 4 concurrent claims
winning per workspace.

### Verification, same gates as every prior fix this session

Full migration chain `001`–`036` (including the two new ones,
`035_purge_claim.sql` and `036_atomic_email_dedup.sql`) run in one pass
on a genuinely fresh Postgres 16 database, plus `000_validate_functions.sql`
— all pass. `tsc --noEmit`: caught a real bug on the first pass — the
release-on-failure `.delete().catch()` calls in the three email-dedup
fixes hit the same "Supabase query builders are thenables, not Promises"
issue this project has hit before; wrapped in `Promise.resolve(...)`
and re-ran clean. `next lint`: still exactly 15 warnings, matching
baseline — nothing new introduced. `next build` with only the 6 required
env vars: compiled successfully, all 79/79 static pages generated, full
route table intact including both edited cron routes.

**One documentation note, not a code issue:** an earlier "not yet
addressed" line in this same file still says `next@14.2.18` — the
installed `package.json` in this delivery is actually already on
`14.2.35` (confirmed via `grep`, not assumed). Leaving both notes in
place rather than silently deleting the stale one; treat the `14.2.35`
confirmation above as current.

---

## Re-verification pass — everything else claimed done, checked for real

A follow-up request asked me to re-confirm every earlier "done" claim in
this file the same way item 4 above was proven, rather than take my own
running summary of past sessions at face value. Most held up exactly as
documented; two didn't, and are called out below rather than quietly
folded into the "confirmed" pile.

**Confirmed, re-proven empirically:** BYOK (all 5 call sites genuinely
invoke the workspace client, not just import it); the `requireWorkspace()`
column list correctly excludes the encrypted key; RLS privilege escalation
(migration 030) — tested as the actual `authenticated` role, not the
superuser connection used elsewhere in this file, since superuser bypasses
RLS entirely and would have silently passed a broken policy: admin
self-promotion blocked, editor self-approval blocked, the owner's
legitimate `brand_voice` update still works, and sneaking `credits_remaining`
into that same update is rejected as a whole statement; invite token leak
(031) — a member-less stranger gets 0 rows, not even a permission-denied
leak of existence; negative-input guard (032) — `reserve_storage`/
`release_storage` called directly with `-5000000` both correctly no-op;
GDPR rate limiting; `safeFetch` SSRF protection — 9 real test cases
including the specific IPv6 hex-form bypass this project's migration
comment describes catching in an earlier draft; `escapeHtml()` applied to
genuinely attacker-controllable fields, not decorative; Stripe webhook
idempotency — 10 concurrent duplicate deliveries of the same `event_id`,
exactly 1 claimed it; `max_tokens: 6000` at exactly the 4 correct routes;
silent auto-retry replaced with a real toast, no server-side
re-generation; `workspaceCatch()` in 52 of 75 route files.

**GDPR export/delete (migration 028) and storage quota (migration 027)
— confirmed built and correct, with one real gap found in the storage
quota surface area.** Export walks 12 tables plus correctly-scoped
versions/comments; delete is owner-only with real server-side password
re-verification; fired 10 concurrent deletion requests at the same
workspace and exactly 1 claimed it, proving the atomic-idempotency claim
under load, not just on paper. DAM uploads, Knowledge Base uploads, and
DALL-E image generation are all correctly wired to
`reserve_storage`/`release_storage` *and* actually reachable from the
app. The one gap: there's a fourth, async/persisted PDF-export path
(`asyncPdfExport` in `functions.ts`) that's also correctly quota-wired
and even has job-status polling support — but nothing in the app ever
sends the `quill/content.export.pdf` event that would trigger it. The
export button users actually click streams a PDF directly without
touching Storage at all, so quota isn't being bypassed today — but this
is dead code sitting next to live code, easy to mistake for the real
path. Left as-is rather than guessing at intent (wire it up, or delete
it) without you weighing in.

**Performance aggregation (migration 033)** — seeded the actual 200,000
rows this time rather than trusting the earlier claim, and confirmed via
`EXPLAIN ANALYZE` that the composite index is genuinely used (bitmap
index scan, not a sequential scan): 200,000 raw rows aggregate to 20
output rows in ~60ms.

**Mobile sidebar** — confirmed exactly as documented: a mount-only
check, not a resize listener, at the 768px threshold.

### 🟡 Found and fixed: accessibility — custom controls had zero keyboard support

The "div-as-button elements converted to proper interactive elements"
line in this file's own history didn't hold up under a real check. A
full sweep for `<div onClick` across every page turned up 21 hits; 17
were modal backdrops or their `stopPropagation()` wrappers, which are
fine as plain divs (each modal has a real visible close/cancel button,
so a keyboard user isn't locked in even without Escape-to-close). The
other 4 were genuine custom controls — a platform multi-select, a
single toggle switch (used twice: "Inject Trending Topic" in the
generator, and every row in Settings → Notification Preferences), and
an invite-role picker — all plain `<div onClick>` with no `role`, no
`tabIndex`, no keyboard handler, and no `role="button"` anywhere at all
in the codebase to point to as evidence the fix had happened elsewhere.
A keyboard-only or screen-reader user could not operate any of them.

Fixed all 4 with the semantically correct ARIA role for what each
actually is, not a blanket `role="button"`:
- Platform chips → `role="checkbox"` + `aria-checked` (independent,
  multi-select)
- Both toggle switches → `role="switch"` + `aria-checked`, labelled via
  `aria-labelledby` (generator) or a direct `aria-label` (the reusable
  `ToggleRow` component, since `aria-labelledby` would need an id
  scoped per-instance across 5 uses on one page)
- Role picker → `role="radiogroup"` around three `role="radio"`
  options, with roving `tabIndex` (only the checked option is in the
  tab order, matching real radio-button behavior) and arrow-key
  navigation between options, not just Tab

All four take Enter or Space to activate, matching native control
behavior. Verified with a real rendered-DOM test (`jsdom` + real
`KeyboardEvent` dispatch, not just reading the JSX): confirmed a
Space keypress on the switch flips `aria-checked` from `false` to
`true`, Enter flips it back, and — as a negative check — a `Tab`
keypress does *not* trigger it. Same result on the checkbox pattern.
7/7 assertions passed. `jsdom` was a one-off dev dependency for this
test and has been removed again afterward; it's not part of this
project's real test setup.

`tsc --noEmit`: 0 errors. `next lint`: still exactly 15, matching
baseline — no new `jsx-a11y` complaints, no regressions. `next build`:
79/79 pages, 0 errors.

---

## Full quality check + working-operations review — all 6 findings fixed

A follow-up request asked for a complete quality/operations audit beyond
re-verifying past claims — a fresh look across the whole codebase for
what's actually wrong. Found 6 real issues; all 6 are fixed and
re-verified below, in the order found.

### 1. `stripe_events` had no RLS enabled

This table is only ever touched by `service_role` (the webhook handler
uses `createSupabaseAdmin()`, which bypasses RLS by role attribute) —
nothing legitimate needed `anon`/`authenticated` to reach it directly.
But Supabase's platform-level default grants apply to every table
whether or not it needs them, so without RLS, any logged-in user of any
workspace could query this table directly via the client API and see
every Stripe `event_id`/`event_type` processed for every workspace on
the platform, not just their own. Confirmed empirically before fixing:
seeded a row, queried it as an ordinary authenticated user with zero
special privileges, got the row back.

Fixed in migration `037_rls_and_fk_indexes.sql`: `ENABLE ROW LEVEL
SECURITY` with zero policies (RLS defaults to deny-all once enabled,
which is correct here since nothing legitimate reads this table as
anon/authenticated), plus an explicit `REVOKE ALL ... FROM anon,
authenticated` on top, rather than relying on "zero policies" alone —
same belt-and-suspenders pattern as migration 030. Re-ran the identical
exploit against the patched schema: `permission denied for table
stripe_events`. Confirmed `service_role` (the actual webhook handler)
still reads normally.

### 2 & 4. Ten FK columns had no covering index

`generation_logs.content_id` is the one that actually matters: its FK
action is `ON DELETE SET NULL`, which — same as `CASCADE` — requires
Postgres to locate every matching row when the referenced
`content_pieces` row is deleted. Without an index that's a full
sequential scan of a table that logs every single AI generation call
(plausibly one of the largest tables in the schema over time), on every
content deletion — both user-driven deletes and the purge-deleted-content
cron (migration 035) hit this routinely, not as an edge case. Seeded
100,000 rows and quantified the real difference by dropping and
restoring the index: ~7.35ms (sequential scan) vs ~2.4ms (bitmap index
scan) at just 100k rows — roughly 3x, and the gap widens as the table
grows in production.

The other nine (`approval_history.actor_user_id`,
`asset_folders.created_by`, `assets.uploaded_by`,
`campaigns.created_by`, `content_versions.created_by`,
`knowledge_documents.uploaded_by`, `usage_overages.user_id`,
`workspaces.deletion_requested_by`, `workspace_invites.invited_by`) are
lower-priority "who did this" audit columns queried far less often than
by `workspace_id` (which is indexed) — added for completeness in the
same migration rather than urgency. `workspace_invites.invited_by` is
worth a second look since it's the one other actual `CASCADE` (not `SET
NULL`) among these ten.

### 3. Next.js was a full major version behind on security patches

`14.2.35` was genuinely the latest available patch on the 14.x line —
nothing had been missed. But 21 CVEs disclosed against Next.js applied
to that version, none fixed within 14.x. Checked real usage before
touching anything: this app uses zero Server Actions, no CSP nonces, no
Pages Router i18n, no `next/script beforeInteractive`, no WebSockets,
and its one `remotePatterns` entry is narrowly scoped rather than a
wildcard — ruling out or meaningfully reducing exposure to most of the
21, but not all of them, and not a substitute for actually patching.

**Upgraded to `next@15.5.23`** (`eslint-config-next` bumped to match).
Mapped the real migration scope first rather than guessing: 8 dynamic
routes needed the `params`-as-Promise change, 11 call sites used
`cookies()` directly (all through the shared `createSupabaseServerClient()`
in `lib/supabase/server.ts`, now `async`), and one client component
(`campaigns/[id]/page.tsx`) needed special handling — checked and
confirmed React 18.3.1 (`React.use === undefined`, checked directly, not
assumed) doesn't have the `use()` hook Next's official codemod would
normally reach for, so used `useParams()` from `next/navigation` instead
of bumping React to 19 too, which would have pulled in a whole separate
layer of breaking changes nobody asked for. `next.config.js`'s
`experimental.serverComponentsExternalPackages` moved to the stable
top-level `serverExternalPackages` key (still worked under 15.5.23 via a
backward-compat shim with a build warning; not something worth relying
on staying around).

**Found while doing this, fixed as part of the same pass:** the
comment-resolve `PATCH` handler was sitting in
`content/[id]/comments/route.ts` — a file with no `[commentId]` segment
at all — while every actual caller
(`src/app/(app)/review/page.tsx`) hits
`/api/content/{id}/comments/{commentId}`. That URL could never match
that file. Not a param-typing issue — a 404 at Next's router level,
before any of the handler's own code ever ran. "Resolve this comment"
has been completely unreachable end-to-end, independent of the Next.js
version. Moved the handler to the file its own doc comment and every
caller always assumed:
`content/[id]/comments/[commentId]/route.ts` (new file), converting it
to the async-params signature at the same time rather than fixing the
route and then having to touch it again immediately after.

**Verification:** `tsc --noEmit` — 0 errors on the first real run
(strong signal the params/cookies migration was done correctly
throughout, not just that it compiled by luck). `next lint` — still
exactly 15, matching baseline. `next build` — 79/79 pages, 0 errors,
config warning gone after the `serverExternalPackages` fix. Confirmed
the new route actually appears in the build's route manifest
(`/api/content/[id]/comments/[commentId]`) alongside the parent.

One more thing surfaced by the upgrade itself: `npm audit` initially
still flagged `next` afterward — but for a completely different reason
than before. Every one of the original 21 Next.js-authored CVEs was
gone; what remained was `next@15.5.23` bundling vulnerable versions of
its own `postcss` and `sharp` dependencies (XSS/arbitrary-file-read in
postcss; inherited libvips CVEs in sharp, used by Next's image
optimizer). No 15.x patch fixes this yet — npm's only suggested fix was
another major bump, to `next@16.3.1`, which wasn't attempted here; two
major version jumps in one pass, the second unscoped, isn't a
responsible way to close a dependency-of-a-dependency issue. Instead,
added a targeted `overrides` block (`postcss@8.5.26`,
`sharp@0.35.3`, both well past the patched thresholds) and verified
empirically that this is safe, not just theoretically compatible: clean
reinstall, then a full rebuild with the overridden versions — 79/79
pages, 0 errors, and `npm audit` now shows `next` fully clean of every
advisory, direct or inherited.

### 6. Dead code: the async/persisted PDF-export pipeline had no live caller

`asyncPdfExport` in `functions.ts` was fully built and correctly
quota-wired (`reserve_storage`/`release_storage`, matching the DAM/KB
upload pattern) — but nothing in the app ever sent the
`quill/content.export.pdf` event that would trigger it. The export
button people actually use streams a PDF directly without touching
Storage or this pipeline at all. Removed rather than wired up: inventing
a new UI trigger (a "save this export" button, a place to list past
exports) would be new feature work, not a bug fix, and there was no
existing frontend signal for what that feature was supposed to look
like. Removed the function itself, its registration in
`api/inngest/route.ts`, and updated the now-stale comment in
`api/jobs/[id]/route.ts` that still listed `pdf_export` as a pollable
job type. Left the historical mention of `pdf_export` in migration
`010_job_results.sql`'s comments alone — migrations in this project are
never retroactively edited, only appended to. Confirmed zero remaining
references anywhere in `src/` after removal; `tsc`/`lint`/`build` all
still clean.

**Not independently fixable (noted, not actioned):** `src/lib/types/database.ts`
remains a deliberate, clearly-labeled placeholder for real
Supabase-generated types — replacing it requires running `supabase gen
types typescript` against a live project, which isn't something
possible from this environment. Nothing wrong with the code; it's a
manual step still pending on the project owner's side.

---

## Fresh ruthless field-by-field pass — 6 findings, all fixed

A follow-up request asked for a from-scratch adversarial test of every
field in the app — explicitly disregarding prior sessions' conclusions —
covering both the user side (forms, buttons, UX) and the operational
side (API validation, database constraints). Ran 100 hand-crafted inputs
against every user-facing Zod schema, real magic-byte payloads against
the upload validator, and live constraint violations against a fresh
Postgres. Found 6 real issues; all 6 fixed and re-verified below.

### 1. LinkedIn and Google Search Console integrations were broken end-to-end

The app-layer `ALLOWED_PROVIDERS` set included `linkedin` and `gsc`; the
database's `integrations_provider_check` constraint, unchanged since
migration 001, only ever allowed `wordpress, buffer, hubspot, mailchimp,
hootsuite`. Traced this into the actual production LinkedIn callback
code (`.from('integrations').upsert({ provider: 'linkedin', ... })`) and
reproduced the exact failure directly against Postgres. Real-world
effect: a user completes the entire OAuth consent flow, tokens exchange
successfully, and the final save silently fails — they land back on
Settings with a generic `..._store_failed` error and no explanation.
Both integrations have been broken at the database layer since they
were built, invisible to `tsc`/lint/build because it's a runtime data
constraint, not a type error.

Fixed in migration `038_fix_integrations_provider_check.sql`: dropped
and recreated the constraint to include `linkedin` and `gsc`. Deliberately
did **not** add `medium` — it's in the allowlist but has no actual
connect/callback route anywhere in the app; adding it to the DB
constraint would misleadingly imply it's a supported integration.
Re-ran the exact previously-failing inserts: both now succeed. Confirmed
a genuinely bogus provider is still rejected. Full validator re-run,
all pass.

### 2. Six destructive actions had zero confirmation step

Asset delete, KB document delete, BYOK key removal, invite revoke,
webhook delete, and domain removal all fired immediately on a single
click — no modal, no undo, inconsistent with campaign delete and GDPR
account deletion, which already had proper guards elsewhere in this
codebase. Confirmed asset deletion specifically is a genuine hard
delete with no soft-delete/trash mechanism.

Built a shared `ConfirmDialog` component matching the existing modal
visual language (same dark-theme card, backdrop-click-to-close pattern
already used by `UpgradeModal` and the campaign-delete modal). Wired it
into all six call sites — `assets/page.tsx` (one action) and
`settings/page.tsx` (five actions, via one shared `pendingConfirm`
discriminated-union state rather than five bespoke modals). Found and
fixed a bonus bug while touching these exact functions: `deleteWebhook`
and `removeDomain` never checked `res.ok` before — they'd show a success
toast even when the request had failed. `tsc`: 0 errors. `next lint`:
still exactly 15, matching baseline. `next build`: 79/79 pages, 0 errors.

### 3. Raw database error messages reached the user in 24 files, 32 places

Confirmed concretely, not just read: a null byte in any text field
passes Zod validation cleanly, then fails at the database with `null
character not permitted` — and that raw Postgres message was
concatenated directly into the JSON response (`'Update failed: ' +
error.message`) in 25 places across 18 customer-facing route files
(7 more occurrences live in the 5 cron routes, left untouched on
purpose — see below).

Added `dbError()` to `lib/utils.ts`: logs the real error server-side,
returns only a safe generic message to the client. Systematically
replaced all 25 customer-facing occurrences, reusing each route's
existing descriptive prefix ("Query failed", "Update failed", etc. —
already reasonable) as the new safe fallback text rather than inventing
new copy. Deliberately did **not** touch the 5 cron routes
(`purge-deleted-content`, `purge-deleted-workspaces`, `reset-usage`,
`aggregate-engagement`, `cleanup-stripe-events`) — those responses are
only ever seen by whoever holds `CRON_SECRET`, not customers, and the
real Postgres error is genuinely useful there for diagnosing a failed
scheduled job; "fixing" this for an ops-only endpoint would make
debugging worse for no user-facing benefit. `tsc`: 0 errors. Confirmed
every file's `@/lib/utils` import correctly picked up `dbError` without
introducing an unused `jsonError` import anywhere (lint stayed at 15).

### 4. `published_url` and `headerImageUrl` accepted `javascript:`/`data:` URL schemes

`z.string().url()` validates shape, not scheme. `headerImageUrl` was
already safe in practice (passes through `assertSafeUrl()`, which does
reject non-http(s) schemes, before use) — `published_url` had no such
gate, and while every render site was checked and confirmed to never
output it as a clickable `href` today, this was worth closing as cheap
defense-in-depth rather than depending on that staying true forever.
Added a scheme-restricting `.refine()` to both fields. Verified with 7
real adversarial cases: `javascript:`, `data:`, `vbscript:`, and `file:`
all correctly rejected; `http://` and `https://` (including with query
params) still pass. 7/7.

### 5. Four smaller gaps, all fixed and re-verified

- **`bulk-repurpose`'s `repurposeTypes`** allowed duplicate values (only
  reachable via direct API calls — confirmed the frontend's checkbox
  toggle logic can never produce them through normal use). Added a
  `.refine()` requiring uniqueness. Verified: 5× duplicate `linkedin`
  correctly rejected, genuinely distinct values still accepted.
- **BYOK key field** accepted any 20+ character string with no format
  check. Added an `sk-ant-` prefix requirement. Verified: real
  Anthropic-shaped keys pass, OpenAI-shaped keys and generic strings
  correctly rejected.
- **Signup password** had no complexity requirement beyond length — 8
  spaces or the literal word "password" both passed. Added a
  letter-and-number requirement to both the server schema and the
  frontend's client-side check (which previously only checked length),
  so both layers now agree.
- **Calendar `scheduledAt`** had no sane date-range bound — year 1900 or
  year 9999 both validated. Added a bound (year 2000 to 10 years out,
  deliberately wide since content calendars legitimately get planned far
  in advance). Verified with 9 cases including both original adversarial
  dates and exact boundary values (year 2000 passes, year 1999 doesn't;
  9 years out passes, 11 doesn't).
- Removed the dead `medium` entry from `ALLOWED_PROVIDERS` (no real
  route ever backed it — see finding 1).

### Final verification, same gates as every fix this session

Full migration chain `001`–`038` (including the new
`038_fix_integrations_provider_check.sql`) on a genuinely fresh
Postgres, plus `000_validate_functions.sql` — all pass. Confirmed via
`pg_get_constraintdef` that the live constraint now includes both
`linkedin` and `gsc`. `tsc --noEmit`: 0 errors. `next lint`: exactly 15,
matching baseline throughout every fix in this pass — no regressions
introduced anywhere. `next build`: 79/79 pages, 0 errors.

---

## Round 2 — two more findings from continuing the same ruthless pass

Asked to keep going after the first 6-issue pass closed out cleanly.
Pushed into territory not yet covered — non-English content handling,
rate-limiter IP trust, pagination — and found two more real, fixable
issues plus one genuine open question I can't resolve without access to
a live deployment.

### 1. Pagination accepted malformed input on `content/route.ts`

`limit`/`offset` query params went straight into `parseInt()` with zero
validation before constructing a Supabase `.range()` call. Confirmed by
computing the actual arguments that would result:
`limit=abc` → `.range(0, NaN)`, `limit=0` → `.range(0, -1)` (inverted),
`limit=-5` → `.range(0, -6)`, `offset=-10` → `.range(-10, 9)` — all
malformed, all would reach PostgREST unvalidated. Checked every other
list endpoint in the app for the same raw-`parseInt` pattern — none of
them share it, so this was isolated to one file, not systemic.

Fixed by clamping both values to sane bounds (`limit` to 1–100, `offset`
to ≥0) with `Number.isFinite()` guards so a non-numeric or `NaN` result
falls back to the default instead of propagating. Re-ran all the
original adversarial cases plus a legitimate baseline against the fixed
logic: all 8 now produce valid, sane ranges.

### 2. Word counting broke for CJK content — real, user-visible

Every word-count computation in the app (9 backend call sites across
`ai/generate`, `ai/humanize`, `ai/repurpose`, content updates, PDF
export, version history, demo generation, and the bulk-repurpose Inngest
function — plus 2 live-editor call sites on the generator page) used
`text.split(/\s+/).length`, which only works for space-delimited
languages. Confirmed directly: a genuine 72-character Chinese paragraph
computed as **"1 word."** Not a synthetic edge case — this number is
rendered straight into the editor UI (`generator/page.tsx`), so anyone
generating or reviewing Chinese, Japanese, or Korean content would see
nonsensically wrong counts throughout the product.

Added `countWords()` to `lib/utils.ts`: counts each CJK/Hangul character
as one word-equivalent unit (the standard approach for scripts that
don't segment into space-delimited words at all — matches how word
processors and CMSs that support CJK typically handle this), and counts
space-delimited words for everything else, so mixed content ("AI技术")
comes out sensible too. Wrote 15 test cases before wiring it in anywhere
— pure Chinese, Japanese hiragana/katakana, Korean Hangul, mixed
Latin+CJK, and edge cases (emoji-only, null bytes, whitespace-only) —
and caught 4 mistakes in my own test's expected values along the way
(guessed rather than computed), corrected each one by hand-verifying the
real character counts before trusting the result. All 15 pass, including
an exact-match re-run of the original 72-character article. Plain-Latin
baseline behavior (`'The quick brown fox...' → 9`) is provably
unchanged — this isn't a rewrite of word counting, it's a script-aware
extension of it.

Swapped all 11 call sites (8 backend, 3 on the frontend — one more than
initially estimated, caught by grepping directly rather than trusting
the earlier count) to the shared function via a small Python script
rather than 11 manual edits, with per-file verification that both the
old pattern and the existing `@/lib/utils` import line were found before
writing anything. One backend `split(/\s+/)` site (`analyzer/trends/route.ts`)
was deliberately left untouched — traced it and confirmed it's word
*extraction* for a search query (`.slice(0, 3)`), not a word *count*,
so it was never part of this bug.

### Not fixed — genuine open question, not a confirmed bug

`getClientIp()` in `lib/rate-limit.ts` trusts the *first* entry in
`X-Forwarded-For`, which is client-supplied and spoofable unless the
hosting platform strips/overrides client-supplied values before
appending the real IP. Tested the header-parsing logic directly and
confirmed it faithfully returns whatever's first, real or spoofed — but
whether that's exploitable depends entirely on Vercel's actual edge
behavior, which isn't something reachable from this environment. Left
as-is rather than "fixing" based on a guess about infrastructure I
can't verify; worth checking against real traffic, or switching to a
platform-provided trusted-IP header if Vercel exposes one.

### Verification

`tsc --noEmit`: 0 errors across both fixes. `next lint`: still exactly
15. `next build`: 79/79 pages, 0 errors. Migration chain re-confirmed
clean (this round touched no schema).

---

## Round 3 — three more findings, all fixed

Kept pushing after round 2 closed out clean. This round's three findings
turned out to match a set of items already flagged as queued-but-not-yet-
implemented from an earlier session — arrived at independently through
fresh testing in this one, with concrete reproductions for each rather
than trusting the earlier framing. One of the three root causes turned
out to differ from how it was previously described (migration 002, not
016 — see below), which is exactly why re-deriving root cause from the
actual current migration files mattered here instead of trusting a
summary.

### 1. Full-text search had no working index — root-caused precisely

`content_pieces` has two full-text-search artifacts that don't match.
Migration 001 created `idx_cp_fts` on an ad-hoc 2-field expression,
written before the real `fts` column existed. Migration 002 correctly
added the actual 5-field `fts` generated column that
`src/app/api/content/route.ts`'s `.textSearch('fts', q, ...)` call
filters on, and even tried to add the right index — but named it
identically (`CREATE INDEX IF NOT EXISTS idx_cp_fts ... USING GIN(fts)`),
so it silently no-op'd against migration 001's already-existing,
wrong-expression index. The fix has been sitting there, dead, since
migration 002 shipped — every content search has been doing a full
table scan since day one.

Confirmed concretely, not just theoretically: seeded 20,000 rows where
only 20 match a realistic search term. With the stale index in place,
`EXPLAIN ANALYZE` showed a full sequential scan. With a correctly-matched
index, the identical query used a real bitmap index scan — dramatically
faster, and the gap only widens as the table grows, since sequential
scan cost is proportional to table size while index scan cost here is
proportional to the (small) number of matches. Fixed in migration
`039_fix_fts_index.sql`: explicit `DROP INDEX IF EXISTS` followed by
`CREATE INDEX` — not `IF NOT EXISTS` again, which is the exact lesson
this bug itself teaches. Re-ran the identical 20,000-row test against
the fixed migration chain: confirmed `idx_cp_fts` now genuinely shows
`gin (fts)`, and the query plan shows a real bitmap index scan.

### 2. Drag-and-drop calendar rescheduling shifted events by a day

Traced the exact mechanics: the reschedule handler in
`(app)/calendar/page.tsx` extracted the *UTC* hour/minute from the
event's original timestamp but combined it with the *local* day/month/
year of the drop target — two different timezone frames mixed in one
`Date.UTC()` call. Reproduced concretely in both directions using real
`TZ`-scoped Node processes: a 9 PM Eastern event dragged onto "Jan 25"
silently landed on Jan 24, 9 PM; a 1 AM Sydney event dragged onto
"Jan 25" landed on Jan 26. Affects any non-UTC timezone whenever the
event's local time is close enough to midnight to cross the UTC day
boundary — common for evening/morning social posts, which is the
product's actual use case, not an edge case. Confirmed the create-event
flow doesn't share this bug (correctly uses the browser's local
interpretation of a `datetime-local` input), and confirmed there's no
separate edit path — drag-and-drop is the only reschedule mechanism, so
this was the complete scope.

Fixed by staying entirely in the local-time frame throughout: extract
the *local* hour/minute (`getHours()`/`getMinutes()`, not the UTC
variants) and construct the new date with the local `Date` constructor,
not `Date.UTC()` — matching how the create-event flow already works
correctly. Re-ran both original reproduction cases against the fix:
both land exactly where the user intended. Also checked the "dropped
back on the same day" no-op detection, since it was subtly affected by
the same root cause — confirmed it now correctly recognizes a same-day
drop and skips the update.

### 3. Webhook failures were completely invisible

Verified the delivery mechanics themselves are genuinely solid before
concluding anything was wrong: the HMAC-SHA256 signing was tested
directly (a simulated receiver recomputes an identical signature; a
tampered payload correctly fails verification), and `safeFetch`'s
redirect re-validation was checked directly against its own source (it
really does re-validate on every hop and strip credentials cross-origin,
matching what its comments claim). What was missing is entirely
downstream of delivery: `deliverWebhook` had no `onFailure` handler, and
`last_fired_at` only ever updated on success — a customer's integration
could break for weeks with zero surface anywhere in the product to
notice it.

Fixed with migration `040_webhook_failure_tracking.sql`: added
`consecutive_failures`, `last_failure_at`, and `last_failure_reason` to
`webhook_endpoints`, plus atomic `record_webhook_failure()` /
`record_webhook_success()` functions rather than a plain JS
read-modify-write — a single endpoint can legitimately receive multiple
different webhook events firing close together, and a naive
increment-in-JS pattern on the same counter is exactly the race class
this project has repeatedly found real bugs in elsewhere. Wired
`record_webhook_failure()` into a new `onFailure` handler on
`deliverWebhook`, matching the exact pattern `asyncImageGeneration`
already established (the callback's `event` argument is a failure
wrapper, not the original event — the real payload is nested at
`failureEvent.data.event.data`). Wired `record_webhook_success()` into
the existing success path, which also resets the failure counter to
zero — a delivery succeeding means whatever was wrong is resolved, so
the UI's failure badge should clear immediately rather than wait for a
human to notice and dismiss it. Tested the full lifecycle directly
against Postgres: 3 recorded failures correctly accumulate the count and
retain the latest reason, and a subsequent recorded success resets both
`consecutive_failures` to 0 and sets `last_fired_at`. Added a red
"⚠ Failing" badge to the webhook row in Settings, shown only when
`consecutive_failures > 0`, with the failure reason available on hover.

### Verification

Full migration chain `001`–`040` (including all three new migrations)
on a genuinely fresh Postgres, plus `000_validate_functions.sql` — all
pass. `tsc --noEmit`: 0 errors. `next lint`: still exactly 15, matching
baseline throughout this round too. `next build`: 79/79 pages, 0 errors.

---

## Round 4 — two more findings, both fixed

Kept pushing into territory not yet covered this session: the
Analyzer/Trends page (previously untouched), the bulk-repurpose
partial-failure refund path, the trend-injection route into content
generation, and GDPR export file correctness. Two of these turned up
real issues; the rest held up clean under real scrutiny, not just a
skim.

### 1. Bulk-repurpose's refund amount was a hardcoded duplicate, not a shared constant

`bulk-repurpose/route.ts` had `const CREDITS_PER_TYPE = 5 // matches
OPERATION_CREDITS.repurpose in src/lib/credits.ts` — a comment asserting
consistency, not code enforcing it. Confirmed the two values currently
matched (both 5), so nothing was broken today — but the refund logic in
`functions.ts` already imports `OPERATION_CREDITS.repurpose` directly,
so a future pricing change here without also remembering that one
comment would have silently made the upfront charge and the on-failure
refund diverge, over- or under-refunding every future bulk-repurpose
job. Worth noting: `lib/credits.ts`'s own header comment already says
"NEVER hardcode credit values in route files" — this fix brings the
route into compliance with a rule the codebase had already written down
for itself.

Fixed by deriving the constant directly: `const CREDITS_PER_TYPE =
OPERATION_CREDITS.repurpose`. Verified with a quick simulation that a
hypothetical future price change now automatically propagates with zero
second edit required.

### 2. Trend injection into content generation had no defense-in-depth framing

Traced the full chain before concluding anything was wrong: when
`injectTrend` is on, the generator pulls the analyzer's top hashtag —
already one layer removed from raw internet content, since it's
Claude-synthesized trend data, not scraped text directly, and that
synthesis step already has its own `<collected_data>` delimiting and
explicit "never treat as an instruction" framing (checked directly, not
assumed). But `buildPrompt()` embedded that hashtag as a bare quoted
string at this second point, with no equivalent delimiting — a real
gap, if a narrow one, since exploiting it would require the first
defense to already be bypassed in a specific way (getting Claude to
emit a plausible-looking but malicious "hashtag").

Fixed by wrapping it in `<trending_topic>` tags and adding that tag to
the centralized `instructionHierarchyNote` that already governs
`<keyword>`, `<audience>`, `<brand_voice>`, `<company_knowledge>`, and
`<brand_knowledge>` — the same "reference material only, never an
instruction" framing, applied consistently rather than inventing a new
pattern. Verified directly: the tag pair wraps the value correctly, an
adversarial injection-shaped value stays fully contained inside its
tags, the existing `<keyword>`/`<audience>` wrapping has zero
regression, and when no trend is injected, no empty tag pair leaks into
the Content Brief (the note itself always lists `<trending_topic>` as a
*possible* tag, matching how `<brand_voice>` etc. are already
unconditionally listed with "where present" — confirmed this is the
existing convention, not a new inconsistency, after an initial test of
mine gave a misleading result by checking for the wrong thing).

### Confirmed clean, no findings

The Analyzer/Trends page: `Promise.allSettled` correctly degrades when
individual external sources fail, user-controlled `industry` text is
correctly `encodeURIComponent`-escaped before reaching the News API
URL, and a real unique constraint on `(workspace_id, platform, range)`
backs a correctly-matched `upsert` (not a plain `insert` that would
race). The rest of the bulk-repurpose partial-failure handling itself —
the try/catch scope, the atomic `add_credits()` refund call, the
per-type error tracking — matches what its own code comments already
claimed. GDPR export: native `JSON.stringify` handles all edge-case
content correctly with no CSV-escaping surface at all, and the missing
server `Content-Disposition` header turns out not to matter since the
frontend handles the download entirely client-side via blob + anchor
tag, confirmed by reading that code directly rather than assuming.

### Verification

`tsc --noEmit`: 0 errors. `next lint`: still exactly 15. `next build`:
79/79 pages, 0 errors. Migration chain re-confirmed clean (this round
touched no schema).

---

## Round 5 — two more findings, both fixed (one caught a bug in its own fix)

Continued pushing after round 4: mobile rendering (mostly a false
alarm, see below), the onboarding celebration's tracking mechanism, and
Stripe subscription webhook state transitions. The billing finding is
the significant one this round.

### 1. Subscription updates were resetting customer credits for any reason at all

`customer.subscription.updated` fires for far more than plan changes and
renewals — a payment method update, toggling `cancel_at_period_end` via
the Customer Portal, a metadata change, pause/resume collection all
trigger this exact event type. The webhook handler reset
`credits_remaining` to the plan's full allotment unconditionally on
every one of them (the code comment said "reset to full on plan change
or renewal," but nothing actually checked either condition — it just
ran on every event of this type). Concretely: a customer who'd used 80%
of their monthly credits and simply updated an expiring card got a
silent, free full refill.

Fixed by adding `stripe_current_period_start` to `workspaces`
(migration `041_stripe_period_and_first_gen.sql`) and only resetting
credits when the incoming event represents a genuine plan change
(compared against the workspace's currently-stored plan) or a genuine
period rollover (compared against the stored period start).
`subscription.created` always resets, since it's definitionally a new
activation with no prior state to compare against.

**Caught a real bug in this fix before shipping it, not after:** the
first version compared period timestamps as raw strings. Stripe's
`toISOString()` always produces the `.000Z` suffix format, but
PostgREST commonly returns `timestamptz` columns using `+00:00` instead
— an equally valid ISO 8601 representation of the exact same instant,
but a *different string*. Tested this directly: `"2026-08-01T00:00:00.000Z"
> "2026-08-01T00:00:00+00:00"` evaluates to `true` in JavaScript's raw
string comparison, even though both represent the identical moment —
which would have reintroduced the same class of bug through a different
path (a false "period rollover" firing on routine updates). Fixed by
comparing `new Date(...).getTime()` instead of raw strings, and
re-verified the exact format-mismatch case explicitly returns `false`
as it should. Tested all 6 real-world scenarios directly: payment
method update (no reset), `cancel_at_period_end` toggle (no reset),
genuine mid-cycle upgrade (resets, correctly, to the new plan's
credits), genuine monthly renewal (resets, correctly), brand-new
subscription (always resets), and the format-mismatch case (no false
rollover).

### 2. The "first generation" celebration is now workspace-level and DB-backed

Was tracked via `localStorage.getItem('quill_first_generation_' +
user.id)` — a user switching devices, browsers, or clearing site data
would see "Your first piece is ready! Welcome to Quill.AI" again on an
account that's been active for months. Also more correctly a
**workspace**-level onboarding milestone per the original roadmap's own
framing ("Workspace setup 2/3 complete" banner tracking first content
as one of the milestones), not a per-user one — a teammate joining a
workspace where a colleague already generated 50 pieces isn't the
product's actual "aha moment" being celebrated.

Added `first_generation_celebrated_at` to `workspaces` (same migration
as above) and an atomic claim in `ai/generate/route.ts` — the same
conditional-`UPDATE`-as-claim pattern already used by `verify-domains`
and GDPR delete elsewhere in this codebase, so two concurrent "first
ever" generations for the same workspace can't both win. The frontend
now reads `isFirstGeneration` from the generation response instead of
touching `localStorage` at all. Fired 10 real concurrent "first
generation" attempts at the same workspace directly against Postgres:
exactly 1 won the claim, the other 9 correctly saw `UPDATE 0`.
Separately confirmed a genuinely later generation for an
already-celebrated workspace correctly sees `UPDATE 0` too, meaning the
celebration won't fire again.

### On the mobile-rendering findings from last round

No fixes needed here — re-confirming what was already established:
Next.js's own framework defaults genuinely inject the viewport meta tag
(verified in real generated HTML output, not assumed), and every
hover-based interaction in the app is decorative only, paired with a
separate `onClick` that works fine on touch.

### Verification

Full migration chain `001`–`041` (including the new migration) on a
genuinely fresh Postgres, plus `000_validate_functions.sql` — all pass.
`tsc --noEmit`: 0 errors. `next lint`: still exactly 15. `next build`:
79/79 pages, 0 errors.

---

## Round 6 — the same credits race, alive in a path that never got the fix

One more finding, fixed the same way the original bug was fixed —
literally the same function pattern, applied to a second code path that
had the identical race and had gone unnoticed.

### BYOK usage_count had the exact same race deduct_credits() was fixed for

Migration `026_atomic_credits.sql` fixed the classic read-modify-write
race for `credits_remaining` across five routes, and — per its own
comment — `deduct_credits()` already atomically increments `usage_count`
too, as part of the same `UPDATE`. But that function is only called on
the credit-based branch. BYOK workspaces (their own Anthropic key, no
credits to deduct) skip it entirely and had their own separate branch
doing exactly the pattern 026's comment warns against:
`usage_count: (ws as any).usage_count + 1` — a value read at the top of
the request, before generation runs, written back after.

Reproduced directly, mirroring the exact test that caught the original
bug: seeded a BYOK workspace at `usage_count = 0`, fired 20 concurrent
requests replaying the real sequence (read → simulated generation delay
→ write old+1). Final count: **1**, not 20 — 19 of 20 increments
silently lost. Checked severity before doing anything: BYOK workspaces
are explicitly excluded from the credit-limit gate
(`!isByok && credits_remaining < cost`), so nothing was being bypassed
— but the count is shown to users in three places (dashboard, generator,
settings), so a BYOK customer running concurrent generations — normal
usage for a paying Agency-tier account — would see a visibly wrong
number in their own UI.

**Found a second instance while fixing the first.** A sweep for the same
pattern across every credit-charging route turned up an identical copy
in `ai/repurpose/route.ts` — same shape, same bug, same fix needed.
Checked the other three credit-charging routes named in migration 026's
own comment (`ai/image`, `ai/bulk-repurpose`,
`content/[id]/plagiarism`) — none of them touch `usage_count` at all, so
the bug was genuinely isolated to these two.

Fixed with `increment_byok_usage_count()` in migration
`042_atomic_byok_usage_count.sql` — same shape as `deduct_credits()`:
a single atomic `UPDATE ... SET usage_count = usage_count + 1 ...
RETURNING`, `SECURITY DEFINER`, granted to `service_role` only. Both
call sites updated to use it. Re-ran the identical 20-concurrent-request
test against the fixed function: **20**, exactly matching the number of
requests — zero lost.

### Verification

Full migration chain `001`–`042` on a genuinely fresh Postgres, plus
`000_validate_functions.sql` — all pass. `tsc --noEmit`: 0 errors.
`next lint`: still exactly 15. `next build`: 79/79 pages, 0 errors.

---

## Round 7 — narrow, low-probability findings, both fixed (one caught mid-fix)

Explicitly asked to keep pushing into narrower territory after round 6.
Both real, both reproduced empirically, both genuinely uncommon to hit
in practice — exactly the kind of findings that get less likely but
don't disappear the more a codebase has already been tested.

### 1. Case-sensitive email matching let duplicate team invites slip through

Both the "already a member?" check and the "expire any existing pending
invite" dedup in `workspace/invites/route.ts` used exact-match `.eq()`
comparisons. Proved it directly: seeded an active member with
`invited_email = 'jane@example.com'`, then ran the app's exact
"already a member?" query for `'Jane@Example.com'` — 0 rows, the guard
doesn't fire. Confirmed the seat-limit function counts raw rows
(`count(*)`), not distinct emails, so this genuinely wasted a real,
paid seat slot on a redundant duplicate invite.

Fixed at the validation boundary: `email: z.string().trim().toLowerCase().email()`
in the invite schema, so every downstream use — the duplicate check, the
dedup, the stored row, the seat-claim call, the delivery address — is
automatically consistent from one change point. **Caught an ordering
mistake in my own first version before shipping it**: I'd originally
written `.email().transform(e => e.toLowerCase().trim())` — but Zod's
`.email()` check validates the *raw* input when the normalization comes
after it in the chain, so a whitespace-padded address like
`"  a@b.com  "` fails validation outright before the transform ever
runs. Tested this directly (`.email()` then `.transform()` rejects
padded input; `.trim().toLowerCase()` chained *before* `.email()`
correctly normalizes first) and fixed the ordering before it shipped.
Added migration `043_normalize_invite_email_casing.sql` to normalize
whatever mixed-case data already exists, not just prevent new cases —
seeded real mixed-case rows, re-ran the migration standalone, confirmed
both `workspace_invites.email` and `workspace_members.invited_email`
came out correctly lowercased.

### 2. Workspace slug assignment during signup had a check-then-act race

Reproduced with two genuine concurrent signups using the identical
workspace name: both saw "no existing slug" before either had inserted,
both attempted the same insert, and the loser hit a hard Postgres
unique-violation — their brand-new auth account got silently rolled
back behind a generic "Failed to create workspace" error. A plain
SELECT-then-INSERT can't close this race by construction, the same
reason every other atomic-claim fix in this codebase exists.

Fixed by replacing the check with a retry-on-conflict loop: attempt the
clean slug first, and on a genuine unique-violation (detected via the
same `error.code === '23505'` pattern already used in the Stripe
webhook handler, not a new one invented for this), retry with a random
suffix, up to 5 attempts. Anything other than a real slug collision
fails immediately rather than burning through retries that can't help.
Verified with 5 real concurrent signups sharing the identical workspace
name, run as a direct SQL simulation of the fixed retry logic against a
fresh database: all 5 succeeded — one claimed the clean slug, the other
four each collided once and got a unique suffixed slug on retry. Zero
failures, zero rolled-back accounts, versus 4 of 5 that would have hard
-failed under the old logic.

### Checked and ruled out, no findings

Numeric overflow on `credits_remaining`/`usage_count` (`INTEGER`,
~2.1 billion ceiling) — not a realistic risk since every increment
requires a real, atomically-protected, cost-incurring API call; storage
counters correctly use `BIGINT` already. DST-transition correctness for
the calendar drag-and-drop fix from round 3 — tested a real US
"spring forward" boundary directly; the fix (kept entirely in
local-time semantics) handles it correctly with no separate DST-specific
logic needed.

### Verification

Full migration chain `001`–`043` (including the new migration) on a
genuinely fresh Postgres, plus `000_validate_functions.sql` — all pass.
`tsc --noEmit`: 0 errors. `next lint`: still exactly 15. `next build`:
79/79 pages, 0 errors.

---

## Part 10 — Deploy to production (Vercel)

Everything above gets you running on `localhost`. This part gets you a
real URL real users can sign up on.

1. **Push the code to a GitHub repo** (Vercel deploys from Git, not a zip
   upload). If you don't have one yet:
   ```bash
   cd quill-ai
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Then create an empty repo on **[github.com](https://github.com/new)**
   and follow the "push an existing repository" instructions it shows you.
   Double-check `.env.local` is **not** in the repo — it's already in
   `.gitignore`, but verify with `git status` before your first commit.

2. **[vercel.com](https://vercel.com)** → sign up (GitHub login is
   easiest) → **Add New → Project** → import the repo you just pushed →
   Vercel auto-detects Next.js, no config needed → **Deploy**. First
   deploy will fail — that's expected, there are no env vars yet.

3. **Settings → Environment Variables** → add every variable from your
   working `.env.local`, one at a time. Two changes from local:
   - `NEXT_PUBLIC_URL` → your real Vercel URL (e.g.
     `https://quill-ai.vercel.app`, or your custom domain once attached)
   - Everything Stripe-related → swap test-mode keys for **live-mode**
     keys once you're ready to accept real payments (Stripe Dashboard →
     toggle out of Test mode → Developers → API keys again)

4. **Redeploy** (Deployments tab → ⋯ on the latest one → Redeploy) now
   that env vars are set.

5. **Update Supabase auth URLs** for the new domain — Part 2 step 5,
   but add your Vercel URL alongside `localhost:3000`, don't replace it
   (keeps local dev working too): Site URL + Redirect URLs both need the
   production domain added.

6. **Stripe webhook for production** — you can't use `stripe listen`
   against a live URL. Instead: Stripe Dashboard → Developers →
   Webhooks → **Add endpoint** → URL = `https://yourdomain.com/api/stripe/webhook`
   → select the events `customer.subscription.*` and
   `checkout.session.completed` → copy the new signing secret into
   Vercel's `STRIPE_WEBHOOK_SECRET` (it's different from your local one).

7. **Cron jobs** (usage reset, trial reminders, domain verification) —
   Vercel Cron needs a `vercel.json` at the project root defining the
   schedules; if it's not already in the zip, this is the one piece you'd
   need to add before relying on those automations in production.

8. **Inngest in production** — install the
   [Inngest Vercel integration](https://www.inngest.com/docs/deploy/vercel)
   from the Vercel Marketplace; it sets `INNGEST_EVENT_KEY` and
   `INNGEST_SIGNING_KEY` for you automatically, no manual copying.

At this point you have a live, real product at a real URL. Everything
from here is iteration, not setup.

---

## Quick troubleshooting

- **`npm run dev` crashes immediately** → check `.env.local` has at least
  the 5 required values from Part 4, no typos in variable names.
- **Signup works but confirmation email never arrives** → check spam;
  also confirm Part 2 step 5 was done (email confirmation must be toggled
  ON, and the redirect URL must include `localhost:3000`).
- **Generation button does nothing / spins forever** → open browser
  DevTools → Network tab → check the `/api/ai/generate` request's
  response for the actual error (usually a missing/invalid `ANTHROPIC_API_KEY`).
- **"relation does not exist" errors anywhere** → a migration didn't run
  or ran out of order — go back to Part 2 step 4 and check the SQL Editor
  history for which one failed.
