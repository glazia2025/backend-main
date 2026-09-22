# Paysharp payments — UPI-only phase

## Deployment configuration

Pay-first changes are on `fix/paysharp-order-after-payment` in backend-main, glazia-frontend and glazia-quotation. Deploy all three together: Paysharp creation now returns `{order: null, checkout: ...}` until payment succeeds. Legacy order responses remain unchanged. Tests do not make real payments.

Set server-only variables in backend-main's hosting environment or ignored `prod.env`:

```env
PAYSHARP_TOKEN=your_matching_environment_token
# Shared root WITHOUT /upi or /order/intent. Sandbox example:
PAYSHARP_BASE_URL=https://sandbox.paysharp.co.in/external/api/v1
QUOTATION_API_BASE_URL=https://quotation-api.glazia.in
Paysharp_test_active=True
Paysharp_Test_users=your_selected_registered_mobile_numbers
```

Use Paysharp's production root and matching production token for live payments. `PAYSHARP_BASE_URL` takes priority for UPI; the backend appends `/upi/order/intent`, `/upi/order/qrcode`, or `/upi/order/{id}`. Existing `PAYSHARP_UPI_BASE_URL` (including `/upi`) remains a compatibility fallback when the common root is unset. Token values exclude the `Bearer ` prefix. Restart backend-main after changing environment variables.

No VA URL or VA webhook registration is required for this UPI phase. Checkout creates a local ledger, without calling Paysharp's customer/virtual-account APIs. Virtual-account provisioning through the account endpoint is disabled, and both apps hide VA account cards and bank details from Paysharp checkout.

Configure the UPI webhook:

```text
POST https://api.glazia.in/api/payments/webhooks/upi
```

Send JSON, without incoming authentication. The backend treats the payload as an untrusted lookup hint and independently verifies the order through Paysharp using its server token. It returns HTTP 200 with `{"code":200,"message":"success"}` after verification and durable handling. Verification/database errors return non-200. Customers can also use Check payment status to query Paysharp again.

Historical VA receipt webhook and admin reconciliation handlers remain for previously issued virtual accounts; they require the old `PAYSHARP_VA_BASE_URL` only if those historical payments need processing. They are not called during UPI checkout. Existing high-value Paysharp orders retain their payment provider and display a contact-Glazia message when UPI is unavailable; they are not silently converted to proof orders.

MongoDB must support transactions (replica set or Atlas). Payment indexes initialize before serving traffic. Use separate databases for sandbox and production payment ledgers.

## Business rules

- Eligible users with totals from ₹1 to below ₹1,00,000 including GST use Paysharp UPI (desktop QR or mobile intent).
- New orders of ₹1,00,000 or more use the existing bank details and proof upload with manual approval during this phase. Amounts below ₹1 also use the legacy flow.
- Rollout-excluded users retain their original QR/bank details and proof upload.
- Both quote and order creation enforce the selected provider server-side; stale or tampered selections return a conflict.
- Full payment is required before fulfillment and dealer-stock consumption for Paysharp orders. Legacy orders retain their existing manual review and stock behavior.
- UPI receipts prioritize the originating order. New checkouts request the full UPI amount; historical unapplied credit is retained and allocated when verified payment is processed. Gross amounts, fees and net amounts are recorded separately.
- Paysharp checkout is stored separately in `paymentcheckouts`. No order, order number, shortage-order link, or stock movement exists until a successful UPI payment is independently verified. Failed, pending and abandoned checkouts stay out of customer/admin order lists.
- Verified payment creates the order, records the receipt, links any shortage purchase and applies inventory effects in one transaction. Duplicate webhook/refresh requests cannot create another order.
- Closing an unpaid checkout preserves the cart and retry key. The Done action and order-history link become available after payment confirmation. Legacy proof-upload steps and screens are unchanged.
- Existing unpaid Paysharp orders from earlier releases are preserved and remain payable; this change does not delete or migrate historical orders.

## Implementation

The storefront sends product identifiers and quantities; main backend loads current catalog pricing and user adjustments. The quotation checkout sends `quotationId`; main backend fetches authenticated BOM data directly from the quotation service and saves the quotation reference. Dealer shortage purchases are priced from server-stored shortage quantities using the dealer's catalog rates. Submitted browser prices/proofs are not trusted. Whole-rupee GST rounding is preserved from the prior checkout. Checkout displays the server quote and confirms its total again before saving.

`checkoutKey` identifies retries of the same checkout. The unique user/key index and account serialization prevent duplicate order creation. A source order is validated when checkout begins; an existing pending checkout blocks duplicate shortage purchases. The source is linked to its upstream order only in the verified-payment transaction.

Collections:

- `paymentcheckouts`: validated server-priced order snapshot, retry key/fingerprint, owner, optional source order, and pending/completed status. These are not orders. No TTL is used because delayed payment notifications must remain recoverable.

- `paymentaccounts`: local payment ledger (with optional historical virtual bank details), unapplied credit, and per-customer serialization revision.
- `paymentattempts`: durable UPI request IDs, amount, QR/intent, provider status. One active attempt per order; terminal attempts are retained when retrying.
- `paymentreceipts`: unique Paysharp reference, gross/fee/net values in integer paise, UTR, date, order allocations and unapplied remainder.
- Existing `userorders`: server-calculated totals, paid amount/status, quotation reference, payment receipt summaries, and existing fulfillment data.

A receipt, its allocations, order status, and stock effects commit atomically. Concurrent duplicate receipts cannot double-credit or consume stock twice. Payment methods are enforced server-side. Manual payment edits are rejected on Paysharp orders. Completion requires full payment, documents, and available shortage stock; inventory addition and completion commit together.

## Verification

- `npm test`: existing backend regression suite.
- `npm run test:payments`: isolated MongoDB replica-set integration suite with a mocked Paysharp API. It downloads a MongoDB test binary on first run and requires permission to bind localhost ports. It does not connect to deployment databases or send real payments.
- Complete merchant sandbox acceptance before live deployment: QR and mobile intent payments with no VA configuration, duplicate notifications, delayed notification recovery, legacy high-value checkout, and dealer shortage replenishment.

Provider references:
- https://www.paysharp.in/developer/api/v1/upi/reference
- https://www.paysharp.in/developer/api/v1/virtual-account/reference

## Controlled rollout

Set these exact case-sensitive environment variable names in `backend-main/prod.env` or the hosting environment:

```env
Paysharp_test_active=True
Paysharp_Test_users=9999999999,8888888888
```

`True` restricts new Paysharp UPI checkout to users whose **registered primary or additional mobile** matches the list. Everyone else sees the existing Glazia bank/QR details and uploads payment proof for manual approval. `False` enables Paysharp UPI for all eligible users regardless of the list. Orders of ₹1,00,000 or more (or below the ₹1 UPI minimum) still use proof upload in this phase. Values are case-insensitive. An omitted flag preserves the prior all-user Paysharp behavior; an invalid non-boolean value enables it for nobody. An empty list with `True` means everyone uses proof upload. Indian `+91` and leading-zero formats are normalized; partial numbers never match.

Restart the main backend after changing deployment environment variables. No frontend environment variables or phone lists are needed. `GET /api/payments/config` returns only the authenticated account's selected provider, never the allowlist. Both apps use `/api/payments/quote` to obtain server-priced checkout and its selected provider. The server rechecks eligibility when creating an order and rejects stale checkout modes. Proof uploads are required and validated for excluded accounts, without any Paysharp API call. Existing order IDs always retain their original payment method when the switch/list changes; receipt webhooks and existing Paysharp orders remain serviceable.

This controls exposure on your existing environment; it does not change Paysharp API endpoints, credentials, or transaction environment. Keep the selected token and base URL consistent.

## Pay-first verification

The integration suite covers no order/counter/inventory changes before payment, pending/failed/expired notifications, forged success, exact amount/customer verification, concurrent webhook and refresh delivery, rollback and retry after inventory failure, quotation snapshots, and shortage linking only after payment. Historical-order fixtures retain coverage for earlier releases and legacy proof-upload regression tests are unchanged.

The existing `/api/payments/orders/:id` status, refresh and UPI endpoints accept the reserved checkout ID until it becomes a real order ID. Pending responses contain `order: null` and `checkout`; paid responses contain `order`. The UPI webhook URL and environment configuration do not change.
