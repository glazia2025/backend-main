# Paysharp order payments

## Configuration and rollout

All changed repositories use branch `feat/paysharp-order-payments`. No deployment or real payment is performed by the implementation/tests.

Set these **server-only** variables in the main backend's deployment environment or ignored `prod.env`:

- `PAYSHARP_TOKEN`: merchant API token from Paysharp. Never expose it as a frontend variable.
- `PAYSHARP_UPI_BASE_URL`: complete UPI API base URL from Paysharp's environment configuration.
- `PAYSHARP_VA_BASE_URL`: complete virtual-account API base URL from the same environment.
- `QUOTATION_API_BASE_URL`: quotation backend used to reprice a saved BOM (default `https://quotation-api.glazia.in`).

Use matching sandbox credentials and endpoints first. The public references do not specify the full sandbox/production base URLs or webhook signatures. We do not guess them or invent a signature scheme. Each webhook is treated as an untrusted lookup hint and independently checked against Paysharp's authenticated status/transaction API. Never log Axios request configuration, tokens, or full webhook payloads.

MongoDB must support transactions (replica set or Atlas). New payment model indexes are initialized before the main backend starts accepting traffic. Payment data for sandbox and production must use separate databases; do not mix merchant environments in one ledger.

Configure two webhook URLs in Paysharp:

- `POST https://api.glazia.in/api/payments/webhooks/upi`
- `POST https://api.glazia.in/api/payments/webhooks/virtual-account`

Both return HTTP 200 with `{"code":200,"message":"success"}` only after verification and durable handling. Transient verification/database failures return non-200 so Paysharp can retry. The VA reference documents four attempts at 15-minute intervals. Admins can recover a missed bank receipt using its Paysharp reference from the order payment panel. A UTR alone is not a Paysharp lookup key.

Deploy the quotation backend's `quotationId` addition, then main backend and the updated storefront, quotation UI, and admin together. Glazia admins can see all new Paysharp orders, including dealer-linked fabricator orders, because Glazia receives those payments. Updated checkout clients use the server-selected payment flow. Existing historical orders retain their manual-payment workflow with ownership checks; their payments are not silently converted to Paysharp receipts.

## Business rules implemented

- Below ₹1,00,000 including GST: UPI or virtual-account bank transfer.
- ₹1,00,000 and above: bank transfer only. Exactly ₹1,00,000 uses bank transfer, consistently in the server and UI.
- The threshold is the full order total, not the remaining balance. UPI's ₹1 provider minimum also applies to the remaining balance.
- Full payment is required before fulfillment and dealer-stock consumption for Paysharp orders. Proof-based orders retain their previous manual review and stock flow.
- Virtual accounts are provisioned idempotently on first access to payment details or checkout, using the stable Glazia user ID. Account details stay attached to that fabricator/dealership. The displayed beneficiary is the provider-returned Paysharp beneficiary.
- Bank receipts apply to the account's oldest unpaid Paysharp order first; excess remains unapplied credit and is consumed by a future order. This was the proposed default pending a different allocation instruction.
- UPI receipts prioritize the order that originated the UPI request; overpayment becomes account credit. Fees and net collected amount are recorded separately from the gross customer payment.
- `AWAITING_PAYMENT`, `PARTIALLY_PAID`, and `PAID` are independent of shipment/completion.
- An unpaid placed order remains payable in account order history. Closing checkout does not cancel the order.

## Implementation

The storefront sends product identifiers and quantities; main backend loads current catalog pricing and user adjustments. The quotation checkout sends `quotationId`; main backend fetches authenticated BOM data directly from the quotation service and saves the quotation reference. Dealer shortage purchases are priced from server-stored shortage quantities using the dealer's catalog rates. Submitted browser prices/proofs are not trusted. Whole-rupee GST rounding is preserved from the prior checkout. Checkout displays the server quote and confirms its total again before saving.

`checkoutKey` identifies retries of the same checkout. The unique user/key index and account serialization prevent duplicate order creation. A source order is validated and linked in the same transaction as its upstream order.

Collections:

- `paymentaccounts`: virtual bank details, unapplied credit, and per-customer serialization revision.
- `paymentattempts`: durable UPI request IDs, amount, QR/intent, provider status. One active attempt per order; terminal attempts are retained when retrying.
- `paymentreceipts`: unique Paysharp reference, gross/fee/net values in integer paise, UTR, date, order allocations and unapplied remainder.
- Existing `userorders`: server-calculated totals, paid amount/status, quotation reference, payment receipt summaries, and existing fulfillment data.

A receipt, its allocations, order status, and stock effects commit atomically. Concurrent duplicate receipts cannot double-credit or consume stock twice. Payment methods are enforced server-side. Manual payment edits are rejected on Paysharp orders. Completion requires full payment, documents, and available shortage stock; inventory addition and completion commit together.

## Verification

- `npm test`: existing backend regression suite.
- `npm run test:payments`: isolated MongoDB replica-set integration suite with a mocked Paysharp API. It downloads a MongoDB test binary on first run and requires permission to bind localhost ports. It does not connect to deployment databases or send real payments.
- Complete merchant sandbox acceptance before live deployment: account provisioning, QR and mobile intent payments, bank transfer notification, duplicates, delayed notification recovery, and dealer shortage replenishment.

Provider references:
- https://www.paysharp.in/developer/api/v1/upi/reference
- https://www.paysharp.in/developer/api/v1/virtual-account/reference

### Local verification results

- 20 backend unit/regression tests pass.
- 21 isolated payment integration tests pass, including failure rollback and the complete dealer-shortage flow.
- Quotation frontend typecheck passes.
- Admin production build passes (existing lint warnings remain). Generated build output was restored; source changes are the deliverable.
- Storefront checkout lint passes. The full storefront typecheck has 126 errors, identical to the starting revision after normalizing line numbers. No new TypeScript diagnostics were introduced.
- Live/sandbox Paysharp acceptance is pending merchant configuration. All provider calls in integration tests are mocked.

## Controlled rollout

Set these exact case-sensitive environment variable names in `backend-main/prod.env` or the hosting environment:

```env
Paysharp_test_active=True
Paysharp_Test_users=9999999999,8888888888
```

`True` restricts new Paysharp checkout and virtual-account provisioning to users whose **registered primary or additional mobile** matches the list. Everyone else sees the existing Glazia bank/QR details and uploads payment proof for manual approval. `False` enables Paysharp for all eligible users regardless of the list. Values are case-insensitive. An omitted flag preserves the prior all-user Paysharp behavior; an invalid non-boolean value enables it for nobody. An empty list with `True` means everyone uses proof upload. Indian `+91` and leading-zero formats are normalized; partial numbers never match.

Restart the main backend after changing deployment environment variables. No frontend environment variables or phone lists are needed. `GET /api/payments/config` returns only the authenticated account's selected provider, never the allowlist. Both apps use `/api/payments/quote` to obtain server-priced checkout and its selected provider. The server rechecks eligibility when creating an order and rejects stale checkout modes. Proof uploads are required and validated for excluded accounts, without any Paysharp API call. Existing order IDs always retain their original payment method when the switch/list changes; receipt webhooks and existing Paysharp orders remain serviceable.

This controls exposure on your existing environment; it does not change Paysharp API endpoints, credentials, or transaction environment. Keep the selected token and base URLs consistent.
