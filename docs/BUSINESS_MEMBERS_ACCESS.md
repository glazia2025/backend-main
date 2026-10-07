# Business members and module access

The existing `User` document remains the business account. Its primary `phoneNumber` is the owner login. Orders, quotations, inventory and commercial settings continue to belong to that same business ID.

## Owner experience

- Open **Business members** from the main-site dashboard or quotation sidebar.
- Add members with their own 10-digit phone number, name and role.
- Enable or disable each module independently. New members start with no module grants.
- Disable a member temporarily, edit their details, or remove them. Existing tokens are checked against current membership on every API request.
- A phone number cannot belong to two businesses, appear twice in one business, or duplicate the owner login.
- Role is a descriptive label, such as Surveyor or Sales executive. Permissions determine access; entering “Owner” as a role does not grant owner privileges.

## Permissions

| Module | What the member can do |
| --- | --- |
| Survey app | Sign in to the survey app and work on accessible quotations and survey items. |
| Quotation | Open the quotation application and work on accessible quotations, designs and reports. |
| Order placement | Create orders, complete checkout and submit payments. |
| Order history | View the business's order history and order details. |
| Inventory | View and maintain the business's inventory, subject to existing fabricator/dealership rules. |

Survey and Quotation each have an independent **Show all business quotations** toggle. When off, lists, statistics, direct links, item changes, duplication and exports are limited to quotations created by that member. The creator identity is the same across both apps. Duplicating an accessible quotation creates a new quotation attributed to the member performing the duplication.

Partner agreements, wallet credit balances and member administration are owner-only. Members with order-placement access can still see bank-transfer instructions; the API omits the wallet balance. Existing business-wide administrative module restrictions still apply. Owners can manage members from the quotation application even when main-site access is administratively disabled.

Dealership fabricator registration, partner agreements and linked-business pricing remain owner-only. Granted members can use dealership stock and order history. Order changes additionally require order-placement permission.

## Owner and member logins

Only the business's primary `phoneNumber` and explicitly created `members[].phoneNumber` are used for login. The old additional-number field, legacy member generation and migration marker have been removed. Admin registration accepts one owner phone number; owners add named members afterward.

New members have no permissions unless the owner assigns them. No old number is automatically converted to a member or given access. Historical quotations without creator data remain visible to owners and members with all-quotation access.

## Remove obsolete database fields

Removing a Mongoose field does not remove its stored data or unique index. Before restarting the updated services, run this one-time cleanup from `backend-main` with the intended database explicitly configured in `MONGO_URI`:

```powershell
# Preview affected documents and indexes.
node scripts/remove-unused-login-fields.js

# Remove only phoneNumbers, membersMigratedAt and the obsolete phoneNumbers index.
node scripts/remove-unused-login-fields.js --apply
```

The cleanup does not create or change members, owner numbers, or permissions. It is safe to rerun. It was verified against an isolated test database; no production database was changed.

## Rollout

1. Deploy `backend-main` and `backend-quotation` together. They share the business database and must use the same JWT configuration. Both contain identical `businessAccess.js` policy code.
2. Remove obsolete database fields and their unique index using the cleanup command above before accepting new registrations.
3. Deploy `glazia-frontend`, `glazia-quotation`, and the updated admin frontend.
4. Install the survey APK, version **1.0.7+8**. Old mobile sessions require a fresh login to obtain a signed survey-app session. Draft storage is keyed by the individual actor ID.
5. Smoke-test one owner and one restricted member against the deployed APIs, including an existing quotation and a newly created survey quotation.

## Local validation

- Main backend unit/regression suite: 44 passing tests, including member CRUD validation, live permission checks and local DNS fallback.
- Quotation backend suite: 77 passing tests, including creator-scoped direct access and independent app visibility.
- Flutter: 18 passing tests; analysis passed; debug APK built successfully.
- Quotation frontend: TypeScript check passed.
- Main storefront: full TypeScript check currently reports 114 errors across catalog, product showcase, API services, examples and other areas. See `glazia-frontend/access-typecheck.log`. This broader check is not clean and is not represented as passing.
- Isolated database tests cover owner/member OTP lookup, member CRUD, phone uniqueness, wallet redaction and obsolete-field/index cleanup.
- The broader payment integration run reported 19 passing and 10 failing tests; unrelated payment failures remain unresolved.

Build: `glazia-survey/build/app/outputs/flutter-apk/app-debug.apk`.
