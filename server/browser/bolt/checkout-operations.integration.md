# Checkout quote integration

This module is read-only. `readCheckoutQuote` never clicks, fills, navigates or
pays. `requestCheckoutApproval` and `verifyCheckoutApproval` delegate to the
existing host-owned `BoltPaymentAuthority`; they do not create authority or a
payment path.

## Host wiring

The host must pass trusted session facts, never tool arguments:

```ts
const host = {
  scope: "host_browser_profile",
  profileKey: approvalScope.profileKey,
  branchId: observation.view.branchId ?? branchFromCheckoutUrl(await port.transport.url()),
} satisfies CheckoutHostFacts;

const quote = await readCheckoutQuote(port.transport, { guard: port.guard, host });
```

Trustworthy sources:

- `profileKey`: the approval identity already used by the host profile, for
  example `boltPaymentAuthority`'s `profileKey`. Do not present it as a provider
  account id unless a trusted profile source proves that id; `providerAccountId`
  is separate and optional.
- No `signedIn` boolean is required. The host browser profile binds approval;
  guest checkout remains possible.
- `branchId`: the route (`/checkout/<branchId>/` or `/p/<branchId>-slug/`) or
  the existing trusted `BoltView.branchId`. A host value that disagrees with
  the route produces `branch_route_mismatch`.
- `paymentMethod`: normally read from the selected payment tab. A host value
  is accepted only as an exact fallback and only if it matches an observed
  selection.
- `courierComment`: read from the checkout note input when present.

If the adapter cannot supply `profileKey`, `quote.status` remains `partial`
while `feeRows`, `adjustments`, delivery options, destination and `totalMinor`
remain available. Production supplies it from the existing host approval scope;
it must not fabricate a provider account or accept these facts from the model.

## Approval flow

```ts
const quote = await readCheckoutQuote(port.transport, { guard: port.guard, host });
if (quote.status !== "complete") return quote; // useful partial quote

const approval = await requestCheckoutApproval(authority, quote);

// Immediately before pay, always re-read; never verify a caller-held quote.
const fresh = await revalidateCheckoutApproval(port.transport, { guard: port.guard, host }, approval.approvalRef, authority);
// fresh.checkout is the exact checkout the existing pay guard must use.
```

`revalidateCheckoutApproval` compares a fresh observation of cart lines, fee
and discount rows, destination, delivery and payment method against the
approved hash. A changed total, cart, address, delivery choice or payment
method makes `authority.verify` reject. Reuse remains the existing runner
journal's `approval_already_used` policy; this module does not record or grant
approvals.

## Exact existing-runner patch request

The current runner still reads `view.checkout` only from the monolithic DOM
profile. To make `read_checkout`, `request_payment_approval` and `pay` use this
atomic quote without weakening the pay guard, the root integrator can apply
this narrow change:

1. Add an optional host-owned source to `BoltPort`:
   ```ts
   checkoutQuote?(host: CheckoutHostFacts): Promise<CheckoutQuote>;
   ```
2. Implement it in `BoltDomPort`:
   ```ts
   checkoutQuote(host: CheckoutHostFacts) {
     return readCheckoutQuote(this.transport, { origin: this.origin, guard: this.guard, host });
   }
   ```
3. Give `BoltRunner` a trusted `checkoutHost` constructor value and, after its
   initial `const before = await this.port.read()`, refresh checkout for
   `read_checkout`, `request_payment_approval` and `pay`:
   ```ts
   const quote = await this.port.checkoutQuote?.(checkoutHost);
   if (quote?.checkout) before.view.checkout = quote.checkout;
   ```
4. Keep every existing pay check after that injection. In particular, `pay`
   must use the newly observed `before.view.checkout` (not an earlier or
   caller-supplied quote) for `authority.verify` and for the click plan. The
   current journal still owns approval-use rejection and pending reconciliation.

Until that patch lands, host wiring can call the module directly for quote and
approval display, but the existing runner's `read_checkout` and `pay` actions
will not see the atomic quote.

## Limits

Fixture-tested, not live-qualified. The selectors come from the public vendor
bundle recorded in `checkout-operations.fixtures.ts`; they are not a claim that
the current account, checkout or payment tab is reachable. The authenticated
quote context still depends on the host session supplier above.
