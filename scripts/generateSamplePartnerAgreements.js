const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const outputDir = path.resolve(__dirname, '../../sample-partner-agreements');
const glazia = { name: 'GLAZIA WINDOORS PRIVATE LIMITED', email: 'sales@glazia.in', phone: '+91 9354876670 / 9958053708', gst: '[GLAZIA GSTIN]', address: 'Kevat Khata No. 361, Rect. No. 21, Killa No. 4/7 0-18, Kherki Daula Village Road, Gurugram, Haryana, India' };
const dealer = { name: 'Sample Glazia Dealership Private Limited', email: 'dealer@example.com', phone: '+91 98765 43210', gst: '06ABCDE1234F1Z5', address: 'Plot 21, Industrial Area, Sector 18, Gurugram, Haryana 122015, India' };
const fabricator = { name: 'Sample Windows & Facades', email: 'fabricator@example.com', phone: '+91 98765 12345', gst: '06ABCDE5678G1Z1', address: 'Unit 8, Fabrication Market, Manesar, Gurugram, Haryana 122050, India' };

const party = (value, role) => `<div class="party"><b>${value.name}</b><br>${value.address}<br>GST No: ${value.gst}<br>Phone: ${value.phone}<br>Email: ${value.email}<br><i>(“${role}”)</i></div>`;
const common = (secondRole, paymentText) => [
  ['4. PRICING, TAXES, PAYMENT AND RECONCILIATION', paymentText || 'Prices and discounts are those accepted for each order and may change for future orders. The purchasing Party shall pay invoices, GST, freight and stated charges within the agreed period. Overdue amounts may result in suspension of supply, credit or platform access.'],
  ['5. DELIVERY, INSPECTION AND RETURNS', 'The receiving Party shall inspect quantities and visible condition promptly and report shortages, transit damage or discrepancies in writing within 48 hours. Returns require prior written approval. Delivery dates are estimates unless expressly guaranteed in writing.'],
  ['6. PRODUCT USE AND QUALITY', `The ${secondRole} shall follow current manuals, approved drawings, fabrication tolerances, installation guidance and safety requirements. It shall not alter Glazia branding, represent non-approved goods as genuine, or make warranties beyond official documentation.`],
  ['7. WARRANTY AND CUSTOMER SERVICE', 'Each Party is responsible for its own workmanship, representations and services. Product warranty requires proof of purchase and compliance with storage, fabrication and installation instructions. Misuse, unauthorized modification and improper installation are excluded to the extent permitted by law.'],
  ['8. CONFIDENTIALITY', 'Non-public prices, customer information, drawings, technical data, software access, business plans and commercial terms are confidential. The receiving Party shall use them only for this relationship, limit access to personnel who need to know and protect them with reasonable care. This duty survives termination for three years; trade secrets remain protected while legally confidential.'],
  ['9. INTELLECTUAL PROPERTY AND BRAND', 'Glazia retains all rights in its trademarks, catalogues, system designs, drawings, software and technical materials. Permission to use Glazia branding is limited, non-transferable and revocable and must cease upon termination.'],
  ['10. COMPLIANCE', 'Each Party shall comply with applicable tax, anti-bribery, competition, consumer protection, labour, environmental, privacy and safety laws; maintain required registrations and licences; and retain accurate transaction records.'],
  ['11. LIABILITY AND INDEMNITY', 'Each Party shall indemnify the other against third-party claims caused by its fraud, wilful misconduct, legal violation, unauthorized representation, negligence or material breach. Neither Party is liable for indirect or consequential loss except where liability cannot lawfully be excluded.'],
  ['12. TERM AND TERMINATION', 'This Agreement begins on execution and continues for three years. Either Party may terminate on 30 days’ written notice, or immediately for uncured material breach, insolvency, fraud, brand misuse or unlawful conduct. Accepted orders, accrued payment, confidentiality, intellectual-property and dispute terms survive.'],
  ['13. FORCE MAJEURE', 'A Party is not liable for delay caused by events beyond reasonable control, provided it promptly notifies the other Party and takes reasonable mitigation steps.'],
  ['14. NOTICES AND DISPUTES', 'Notices must be written and sent to the addresses or emails above. The Parties shall first seek good-faith resolution. Unresolved disputes shall be referred to a sole mutually appointed arbitrator under the Arbitration and Conciliation Act, 1996. The seat and venue shall be Gurugram, Haryana; proceedings shall be in English; Indian law governs; and Gurugram courts have jurisdiction for permitted court proceedings.'],
  ['15. GENERAL', 'This Agreement, accepted orders and referenced policies are the entire understanding on their subject matter. Amendments and waivers must be written. Assignment requires consent except in a lawful business reorganization. Invalid provisions are severed without affecting the remainder. Electronic execution and counterparts are permitted to the extent allowed by law.'],
];

function document({ title, first, firstRole, second, secondRole, orderText, stockText, paymentText }) {
  const clauses = [
    ['1. PURPOSE AND APPOINTMENT', `${firstRole} appoints the ${secondRole} on a non-exclusive basis to market, purchase, supply, fabricate or install approved Glazia aluminium systems, profiles, hardware and accessories for mutually agreed projects and territory. This Agreement creates no employment, franchise, legal partnership or authority to bind the other Party.`],
    ['2. ORDERS AND FULFILMENT', orderText],
    ['3. INVENTORY AND CUSTODY', stockText],
    ...common(secondRole, paymentText),
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:"Times New Roman",serif;font-size:11pt;line-height:1.45;color:#111}h1{text-align:center;text-decoration:underline;font-size:16pt}h2{font-size:12pt;margin:18px 0 5px}.party{border:1px solid #aaa;padding:10px;margin:8px 0}.clause{break-inside:avoid}.sample{background:#fff3cd;border:1px solid #e5ca70;padding:8px;text-align:center;font-family:Arial,sans-serif;font-size:9pt}.sign{width:100%;margin-top:45px}.sign td{width:50%;vertical-align:top}</style></head><body><div class="sample">SAMPLE FOR REVIEW — FICTIONAL PARTY DETAILS — NOT EXECUTED</div><h1>${title}</h1><p>This Agreement is executed on <b>4 September 2026</b> at Gurugram, Haryana.</p><p><b>BY AND BETWEEN</b></p>${party(first, firstRole)}<p><b>AND</b></p>${party(second, secondRole)}<p>Together, the “Parties”, and individually, a “Party”.</p>${clauses.map(([h,t]) => `<div class="clause"><h2>${h}</h2><p>${t}</p></div>`).join('')}<p><b>IN WITNESS WHEREOF</b>, the Parties execute this Agreement through authorized representatives.</p><table class="sign"><tr><td><b>${first.name}</b><br><br>Signature: __________________<br>Name: _____________________<br>Title: ______________________<br>Date: ______________________</td><td><b>${second.name}</b><br><br>Signature: __________________<br>Name: _____________________<br>Title: ______________________<br>Date: ______________________</td></tr></table><h2>ANNEXURE A — APPROVED SYSTEMS</h2><p>C-Series, E-Series and P-Series Sliding; C4, C5, E131 and E231 Casement; ESF and PSF Slide & Fold; Railing; C1645 Internal Partition; and other products approved in writing.</p></body></html>`;
}

const agreements = [
  ['sample-glazia-to-dealership-agreement.pdf', document({ title: 'GLAZIA–DEALERSHIP PARTNER AGREEMENT', first: glazia, firstRole: 'Glazia', second: dealer, secondRole: 'Dealership', orderText: 'The Dealership may order goods for its own stock or place an order for direct delivery to a registered Fabricator. Direct-delivery goods shall not enter Dealership stock. Product, quantity, price, GST, freight, credit and delivery terms in an accepted order or invoice prevail.', stockText: 'Products ordered for Dealership stock are added to inventory only when marked delivered. The Dealership is responsible for custody, safe storage, insurance and accurate stock records. Authorized manual corrections must remain in the inventory audit ledger.', paymentText: 'Prices and discounts are those accepted for each order and may change for future orders. Payments received by Glazia against orders placed by Fabricators registered under the Dealership shall be collected by Glazia and recorded as a credit note in the Dealership’s wallet. The wallet credit may be applied toward amounts payable by the Dealership for orders that it places with Glazia. The Parties shall reconcile Fabricator collections, credit notes, wallet utilization, invoices, taxes, returns, cancellations and other agreed adjustments at the end of each calendar month or on an interim date mutually selected by the Parties. Following reconciliation, the resulting net balance shall be confirmed and settled between Glazia and the Dealership within the mutually agreed period. Overdue amounts may result in suspension of supply, credit or platform access.' })],
  ['sample-dealership-to-fabricator-agreement.pdf', document({ title: 'DEALERSHIP–FABRICATOR PARTNER AGREEMENT', first: dealer, firstRole: 'Dealership', second: fabricator, secondRole: 'Fabricator', orderText: 'Fabricator orders shall first be checked against Dealership stock. Available quantities are deducted when ordered. If unavailable, the Dealership may order from Glazia for delivery to the Fabricator; those goods shall not enter Dealership stock.', stockText: 'The Dealership shall maintain accurate stock. Fabricator orders fulfilled locally reduce that stock. Risk passes as stated in the applicable invoice or dispatch document; title remains subject to full payment.' })],
];

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [filename, html] of agreements) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({ path: path.join(outputDir, filename), format: 'A4', printBackground: true, margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' } });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`Generated ${agreements.length} sample agreements in ${outputDir}`);
})().catch(error => { console.error(error); process.exit(1); });
