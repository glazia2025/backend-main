# Glazia — User-facing feature inventory

Reviewed against the source code on **6 October 2026**.

This document describes what people can do in `glazia-frontend` and `glazia-quotation`, including the supporting capabilities in `backend-main` and `backend-quotation`. Features are grouped by user journey rather than by API or code structure.

**Status guide:** Unmarked features have implementation in the reviewed source; this is not a production acceptance test. **Backend capability** means a supporting service exists but a complete screen in these two apps was not established. **Partial/demo** and **Placeholder** features are explicitly separated below. Availability can depend on account permissions, catalogue configuration and payment-provider settings.

The separate Flutter app `glazia-survey` and other repositories are outside this inventory.

## 1. Who uses Glazia?

### Business owners and members (updated 7 October 2026)

- The owner retains the business account and primary phone login, and can manage members from the main dashboard or quotation sidebar.
- Each member has an individual phone login, name, role, active status and permissions for Survey, Quotation, Order placement, Order history and Inventory.
- Survey and Quotation independently allow all business quotations or only quotations created by that member.
- Partner agreements, wallet credit balances and member administration are owner-only.
- Admin registration accepts one owner phone number. Owners add named members with explicit permissions; there is no additional-number login list.
- See [Business members and access](BUSINESS_MEMBERS_ACCESS.md) for behavior, database cleanup and validation details.

| User | Main tasks |
|---|---|
| Visitor or prospective customer | Explore products, read technical/product information, learn about Glazia and find contact details. |
| Registered fabricator/business customer | Buy profiles and hardware, manage orders and stock, prepare customer quotations. |
| Dealership user | Manage fabricators, customer pricing, dealership stock and order fulfilment. |
| Quotation/sales user | Configure openings, price projects, share quotations and prepare material reports. |
| Administrator | Maintain products and pricing, manage access, review stock/payment requests and maintain quotation rules. Administrative capabilities below are predominantly backend capabilities. |

## 2. `glazia-frontend`: discover and purchase products

### 2.1 Explore the Glazia offering

- Browse a home page with featured categories, products and company information.
- Explore aluminium window/door profiles, hardware and railing product categories.
- Read product descriptions and inspect product images or technical drawings in an enlarged view.
- Browse profiles by category and size/series grouping.
- Search products by descriptive text or product code within supported catalogue screens.
- See product identifiers and specifications such as profile length and weight information where provided.
- Browse hardware groupings and their available products.
- See enabled/available catalogue entries; administrators can control catalogue visibility.
- View the current NALCO aluminium price and open its price-history graph.
- Read blog listings, browse by category and open individual articles.
- Read About, Contact, privacy, terms, shipping, return, refund and cookie-policy pages.
- Find contact and support information for product or project enquiries.

**Access distinction:** Some catalogue content is limited for visitors; signing in unlocks account-specific access and purchasing. The Contact page contains a message form, but its reviewed code does not connect submission to a service; successful message delivery is not an established feature.

### 2.2 Register and access a business account

- Sign in with a phone number and WhatsApp OTP.
- Register business name, email, GST number and business address.
- Provide an authorised person's name and designation.
- Review business information as part of the partner-agreement flow.
- Submit a partner-agreement PDF during supported registration flows.
- See account/profile information and agreement status in the account dashboard.
- Access permitted modules according to the account's assigned access.
- Sign out of the account.

**Backend capability:** Update stored user details. A dashboard link or profile summary alone should not be interpreted as proof of a complete self-service profile editor.

### 2.3 Build a purchase cart

- Choose quantities for profile and hardware products.
- Add products to a cart from catalogue pages.
- See when a product is already in the cart.
- Review cart items and quantities in the cart sidebar.
- Adjust quantities or remove items before checkout.
- Review the order and server-calculated pricing before placing it.
- Receive pricing that reflects applicable product and customer/dealership pricing configuration.

### 2.4 Place and pay for orders

- Place an order from selected catalogue products.
- Review product totals, tax and the payable total before confirming checkout.
- Pay through UPI when enabled for the order.
- Open a UPI payment app on supported mobile devices or display a QR code where supported.
- Return to an already-created order to finish payment.
- See whether payment is awaiting receipt, partially received or paid.
- See the total received and outstanding amount.
- Refresh payment status and retry an expired or failed UPI request.
- View recorded receipts, payment method, UTR/reference and receipt time.
- See unapplied account credit when available.
- Use the configured legacy payment/proof-submission flow where applicable.
- Submit payment proof and review order-linked payment information in supported flows.

**Backend support:** Paysharp payment verification, UPI and virtual-account bank-transfer reconciliation, receipt allocation and paid-order completion. Bank-transfer handling in the service does not imply that every checkout screen exposes bank-account instructions.

### 2.5 Follow orders and access documents

- View an account dashboard with recent order and proforma-invoice information.
- Open the My Orders list and inspect an individual order.
- Review ordered products, quantities, customer information and payment details.
- Follow the order's displayed status/timeline.
- Access available proforma/payment and fulfilment documents through the relevant order views.
- In supported dealership order views, inspect Bilty, E-Way Bill and tax-invoice documents.

Document availability depends on the order's stage and uploaded/generated records. This is not a claim of automatic shipment tracking by an external carrier.

## 3. `glazia-frontend`: manage fabricator and dealership operations

### 3.1 Fabricator inventory

- Open **My inventory** to see products held in stock.
- Search stock by item name or product code.
- Add a stock item from the catalogue or enter supported custom item details.
- Record a product code, name and stock quantity.
- Attach a supported product image.
- Edit stock quantities as stock changes.
- Delete a stock item through a confirmation flow.

### 3.2 Dealership's fabricator network

- Open a dealership management area for the authorised dealership account.
- List linked fabricators.
- Register a fabricator with business and partner-agreement information.
- View and adjust a fabricator's applicable dynamic pricing.
- Manage customer-specific profile and hardware pricing through the available pricing controls.
- Search and inspect orders associated with the dealership's network.

### 3.3 Dealership stock and fulfilment

- View dealership inventory and available stock.
- Add inventory items and associated images.
- Adjust stock quantities and remove supported inventory entries.
- View stock-adjustment requests and their review state.
- Open an order's detail view and decide its supported fulfilment handling.
- Review customer, product and payment information for an order.
- Where the account and order allow it, review payment proof, edit payment due dates, and complete an order/release dispatch.
- Inspect fulfilment documents and the order's progress.

**Access distinction:** These controls are role- and order-state-dependent. A fabricator's own inventory screen and a dealership stock/approval workflow are different features.

## 4. `glazia-frontend`: existing quotation screens

The storefront also contains its own quotation pages. These overlap with the dedicated quotation app but should not be assumed to have identical behaviour.

- List saved quotations with customer/quotation information.
- Search and browse paginated quotations.
- Create a quotation and reopen one for editing.
- Add quotation items and configure window/door specifications through the existing configurator components.
- View quotation totals and customer/project details.
- Preview/download quotations as PDFs through the existing export flow.
- Delete quotations from the list where offered.
- Open quotation settings to configure supported defaults and rates.

The dedicated app's detailed capabilities are listed next. Its advanced behaviours should not automatically be attributed to every older storefront quotation screen.

## 5. `glazia-quotation`: prepare and manage quotations

### 5.1 Access and overview

- Sign in using the shared account/OTP service, subject to quotation-module access.
- Navigate between Dashboard, Quotations and Global Settings.
- Collapse the desktop navigation sidebar.
- View quotation-related dashboard metrics: total quotations, confirmed orders, conversion rate and reported revenue.
- Select a year for supported charts and metrics.
- View quotation-stage distribution and monthly sales information from the quotation backend.

Revenue and confirmed-order metrics reflect the quotation service's records/status calculations; they should not be described as audited accounting or collected-payment figures. Some operational dashboard data is sample/static content; see section 10.

### 5.2 Organise the quotation pipeline

- Search quotations by quotation/customer information.
- Browse saved quotations in a paginated list.
- Create, reopen, duplicate and delete quotations.
- Track a quotation as **Enquiry**, **Quoted**, **Under Negotiation**, **Order Confirmed** or **Order Lost**.
- Maintain the customer's name, email, phone and billing address, including city/state/PIN code.
- Maintain quotation details, date and supported commercial notes/terms.
- Separate quotation editing into Details, Global Config, Item List and Global Edit views.
- See save progress and failed-save feedback while editing supported metadata.

### 5.3 Manage quotation items

- Add a window/door item using the full-page visual configurator.
- Reopen an existing item for changes.
- Assign a reference code and installation/location label.
- Set the quantity and remarks.
- Review item dimensions, area, rate and amount.
- Inspect the section breakdown of a combination item.
- Duplicate an item with a new reference code.
- Delete an item with confirmation.
- Reorder items in the quotation.
- Browse long item lists using pagination.
- Replace a glass specification or colour finish across matching items through Global Edit.
- Choose supported item information to show in the customer PDF.

## 6. `glazia-quotation`: design windows and doors

### 6.1 Configure a single opening

- Enter the overall opening width and height in millimetres.
- View the design and its calculated area.
- Choose an available system, series and description.
- Configure Casement, Sliding and Slide N Fold designs; use Louvers where available in the catalogue.
- Choose colour finish and glass specification.
- Specify whether a section includes glass.
- Configure mesh according to the system; Sliding mesh is derived from its description.
- Choose supported shutter hardware for applicable Casement designs.
- Choose handles and their available colours; fixed sections disable handle selection.
- Set frame and shutter cut angles where allowed; Casement uses 45°.
- See a visual representation appropriate to the chosen opening/description.

### 6.2 Build combination designs

- Divide an opening into horizontal or vertical sections.
- Choose a split count from two to five in a split operation.
- Combine different supported section systems within one overall frame.
- Select the whole frame or an individual section and edit the fields relevant to that selection.
- Resize sections while redistributing the remaining space among siblings.
- Merge a section group back together.
- Add a Blank Area section to represent a non-quoted part of a combination.
- Keep a shared parent colour, location, quantity and remarks while specifying child details separately.
- See automatically derived child reference labels.
- Select a divider and choose Mullion (M) or Coupler (C).
- Use undo/redo for design-tree changes and reset the design preset.

**Scope note:** Undo/redo is not a complete history of every form field. Geometry, pricing and save edge cases identified in the separate configurator audit remain relevant.

### 6.3 Configure panels and special shapes

- See description-driven Sliding and Slide N Fold panel arrangements.
- Adjust supported panel widths.
- Select individual Sliding panels and set their movement: left, right, double or fixed.
- Add a circular-style or triangular arch to an eligible all-Casement whole frame.
- Adjust the arch rise.
- Add an exhaust-fan insert to an eligible Casement/Fix leaf.
- Adjust the fan's position and size within allowed bounds.
- See mesh, fixed panes, opening indicators, louvers and blank areas in the drawing.
- Save a generated design image with the item for quotation and elevation output.

## 7. `glazia-quotation`: pricing and commercial presentation

### 7.1 Calculate the price

- Calculate material-based rates from the configured system, series, description, dimensions and cutting schedule.
- Include the applicable colour, glass, mesh and handle costs.
- Include eligible exhaust-fan pricing and special louver pricing.
- Price combination sections and their mullion/coupler joins together.
- Multiply the item price by quantity and review its amount in the quotation.
- Enter supported manual rates when editing existing items.
- Recalculate when configuration changes require a new price.
- Receive calculation errors when required schedules or pricing inputs are unavailable.

**Backend support:** Material calculations use configured profiles, hardware/beading links, user pricing and NALCO inputs. The resulting record can retain the calculation date, base rate, profile weight/material value and pricing version. These are supporting capabilities, not necessarily separate customer-visible controls.

### 7.2 Set commercial defaults and additional costs

- Configure reusable quotation branding and company/contact information.
- Add a company logo and website information.
- Maintain prerequisites and terms and conditions.
- Configure supported quotation structure and presentation defaults.
- Apply supported installation, transport, additional-cost and discount settings.
- Review the resulting quotation summary and total.
- Override supported settings at quotation level through Global Config.

### 7.3 Maintain personal option pricing

- Search and maintain colour-finish rates.
- Search and maintain mesh rates.
- Search and maintain glass rates.
- Add supported personal options and update/delete personal entries.
- Override supported administrator-defined option rates for the account.
- Maintain supported hardware/handle entries and colour-specific handle rates.

**Backend capability:** User-specific hardware records/rate overrides and handle-option management are also provided by the quotation service. The visible settings navigation is Quotation Structure, Colour Finish Rate, Mesh Rate, Glass Rate and Hardware; an unused component alone is not an additional advertised settings page.

## 8. `glazia-quotation`: share, report and purchase materials

### 8.1 Send a customer quotation

- Generate a branded quotation PDF.
- Preview the PDF before downloading it.
- Download a quotation PDF directly through the supported download action.
- See preparation/generation state for reports that take time.
- Share a generated quotation with the customer's WhatsApp number.
- Export quotation data as an Excel workbook.

**Backend support:** Quotation PDFs can be prepared as background jobs and retrieved when ready. WhatsApp sharing uses `backend-main`; document generation uses `backend-quotation`.

### 8.2 Prepare fabrication and procurement information

- Generate an elevation PDF containing opening/design information.
- Generate a bill of materials (BOM) PDF.
- Generate a glass report PDF.
- Generate a cutting-schedule PDF with the supported material optimization output.
- Preview and download these generated reports.
- Start a material order from the BOM preview.
- Review/pay for the resulting material purchase using the shared checkout, including configured UPI or legacy payment flows.

**Backend capability:** Structured BOM and optimized-final data are available to support material planning and ordering. These reports are not a complete production scheduling or shop-floor tracking module.

## 9. Administration and supporting backend services

The following are **backend capabilities** for authorised administrators/operators. This inventory does not claim that a complete administrator interface exists inside the two reviewed frontends for every operation.

### 9.1 Product and content administration — `backend-main`

- Add, edit and remove profile and hardware catalogue entries.
- Maintain profile categories, sizes and their product relationships.
- Maintain hardware categories.
- Enable or disable products, categories and supported catalogue groupings.
- Add products in bulk through the provided administration operation.
- Maintain technical sheets and product information.
- Update NALCO pricing and expose its historical graph.
- Send a supported NALCO-price broadcast and inspect broadcast status.
- Create, update and delete blog content.
- Search products/hardware to locate catalogue records.

### 9.2 Account, network and enquiry administration — `backend-main`

- List and manage users and their module access.
- Assign a fabricator to a dealership.
- Promote an eligible account to dealership status with agreement information.
- Configure customer-specific dynamic pricing.
- Maintain administrator accounts and their permissions.
- Review captured phone/enquiry leads and update or remove those records.
- View supported business/usage analytics and filtered dashboard data.

### 9.3 Orders, payments and inventory administration — `backend-main`

- Review orders and payment-proof records.
- Approve supported legacy payment records.
- Update payment due dates and complete supported order/dispatch flows.
- Reconcile provider payments and update order payment state.
- Maintain central Glazia inventory.
- Review inventory movements.
- Approve or reject stock-adjustment requests.
- Support dealership and fabricator inventory records separately.
- Use server-calculated purchase pricing for catalogue and quotation-material orders.

### 9.4 Quotation catalogue and rules — `backend-quotation`

- Maintain supported systems and their series/descriptions.
- Maintain global option sets, base-rate records, handle rules and handle options.
- Configure cutting schedules by system, series, description and cut-angle variant.
- Search the profile/material catalogue while defining schedules.
- Configure glass beading for the relevant design/glass selection.
- Configure mullion and coupler material rules.
- Link hardware requirements to supported design descriptions.
- Maintain reusable quotation configuration.
- Store quotations, individual items, combination children and joins.
- Support item creation, editing, deletion, reordering and bulk updates.
- Produce quotation analytics, PDFs, Excel, BOM, glass, elevation and cutting outputs.

## 10. Partial, sample and placeholder features

These should **not** be presented as completed operational features.

| Area | What the reviewed source actually contains |
|---|---|
| Quotation ERP CRM | Lead board/detail components backed by sample records in `crm-service.ts`; a production CRM workflow is not established. This is separate from backend-main's enquiry/phone-lead administration. |
| Quotation ERP Survey | Placeholder describing task assignment, measurement entry and field images. |
| Quotation ERP Orders | Placeholder describing converted quotations and execution tracking. Actual material purchasing exists through the BOM/shared checkout flow. |
| Quotation ERP Inventory | Placeholder describing warehouse stock and movements. The storefront's fabricator/dealership inventory features are separate implemented screens. |
| Quotation ERP Production | Placeholder describing work orders, manufacturing stages and bottlenecks. |
| Quotation ERP Dispatch | Placeholder describing vehicle planning, deliveries and packing readiness. Storefront order fulfilment/document features are separate. |
| Quotation ERP Installation | Placeholder describing crew assignment, completion/snags and customer handover. |
| Quotation ERP Invoices | Placeholder describing billing, collections and follow-up. Existing purchase/payment/proforma capabilities do not make this module complete. |
| Dashboard operational cards/tasks | Some operational numbers/tasks are hard-coded sample content; quotation metrics/charts have backend calls. |
| Contact message submission | A visual form exists, but no connected submit handler/service is established in the reviewed page. |
| Excel import | An import controller reference exists, but the reviewed quotation router does not register an import route; do not advertise an available import workflow. |
| AR or laser measurement in these apps | Not established as a feature of either reviewed web application. The separate Flutter survey project is outside scope. |

## 11. How the apps and services work together

| User journey | App/screen | Supporting service |
|---|---|---|
| Sign in/register/manage access | Storefront and quotation login | `backend-main` authentication/users |
| Browse and buy materials | Storefront catalogue/cart/checkout | `backend-main` products, pricing, orders and payments |
| Manage owned stock | Storefront fabricator/dealership areas | `backend-main` inventory/dealership services |
| Configure and price openings | Dedicated quotation configurator; older storefront quotation flow | `backend-quotation` catalogue, rate calculation and item storage |
| Prepare/share a customer proposal | Quotation builder/export/share | `backend-quotation` reports; `backend-main` WhatsApp sharing |
| Buy materials for a quotation | BOM order action/shared checkout | `backend-quotation` BOM; `backend-main` pricing/orders/payments |
| Maintain business rules | Authorised administration integrations | Both backends, according to feature ownership |

## 12. Source references

These links provide implementation entry points rather than a duplicate API inventory.

- [Storefront pages](glazia-frontend/src/app), [components](glazia-frontend/src/components) and [API clients](glazia-frontend/src/services).
- [Storefront catalogue](glazia-frontend/src/app/categories), [account area](glazia-frontend/src/app/account) and [existing quotation pages](glazia-frontend/src/app/quotations).
- [Shared storefront checkout](glazia-frontend/src/components/PaysharpCheckout.tsx) and [business registration](glazia-frontend/src/components/UserRegistrationForm.tsx).
- [Dedicated quotation modules](glazia-quotation/modules) and [ERP pages](glazia-quotation/app/%28erp%29).
- [Quotation builder](glazia-quotation/modules/quotation/components/quotation-builder.tsx), [quotation list](glazia-quotation/modules/quotation/components/quotation-list.tsx) and [configurator](glazia-quotation/modules/product-configurator/components/window-door-configurator.tsx).
- [Settings sections](glazia-quotation/modules/settings/constants.ts), [dashboard](glazia-quotation/modules/dashboard/components/dashboard-overview.tsx) and [sample CRM service](glazia-quotation/services/crm-service.ts).
- [Main backend routes](backend-main/src/routes), [controllers](backend-main/src/controllers) and [services](backend-main/src/services).
- [Quotation backend routes](backend-quotation/src/routes), [controllers](backend-quotation/src/controllers) and [rate service](backend-quotation/src/services/quotationRateService.js).
- [Detailed configurator behaviour audit](glazia-survey/docs/window-door-configurator-audit.md), including known source inconsistencies and round-trip limitations.

This inventory records source-visible features and their boundaries. It does not assert that every feature is deployed, correctly configured or free of defects.
