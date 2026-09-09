-- Stage 3 item 4 (Stripe real-mode testing) surfaced a real gap: Stripe
-- reports cancel_at_period_end and current_period_end on every
-- subscription object, but this app never stored either. A customer who
-- cancels via the Customer Portal (which defaults to "cancel at period
-- end", not immediate cancellation) would see their workspace continue to
-- report subscription_status = 'active' with zero indication anywhere
-- that it's scheduled to end — right up until the moment Stripe actually
-- fires customer.subscription.deleted and zeroes their credits out with
-- no warning. Confirmed empirically: `workspaces` had
-- stripe_current_period_start but no counterpart _end, and no
-- cancel_at_period_end column at all.

ALTER TABLE workspaces
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN stripe_current_period_end TIMESTAMPTZ;

COMMENT ON COLUMN workspaces.cancel_at_period_end IS
  'Synced from Stripe subscription.cancel_at_period_end on every customer.subscription.created/updated webhook. True between a Customer Portal cancellation and the actual period end; resets to false if the customer resumes before then.';
COMMENT ON COLUMN workspaces.stripe_current_period_end IS
  'Synced from Stripe subscription.current_period_end. Paired with the existing stripe_current_period_start; used to show customers exactly when a scheduled cancellation takes effect.';
