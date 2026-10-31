'use strict';
function makeDemoData() {
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  return {
    vendors: [
      { id: 'v1', name: 'Harbor Print & Packaging', contact: 'Dana Whitfield' },
      { id: 'v2', name: 'Brightline Electrical', contact: 'Marcus Oyelaran' },
      { id: 'v3', name: 'Copperleaf Catering', contact: 'Priya Nair' },
      { id: 'v4', name: 'Northgate IT Services', contact: 'Tom Heller' },
      { id: 'v5', name: 'Summit Office Supply', contact: 'Elena Rossi' },
      { id: 'v6', name: 'Lumen Marketing Studio', contact: 'Jonah Park' },
    ],
    invoices: [
      { id: 'INV-1042', vendorId: 'v4', amount: 8450, due: daysAgo(47), status: 'Overdue', reminders: [
        { id: 'seed-INV-1042-1', date: daysAgo(30), kind: 'Contacted', text: 'First reminder sent by phone.' },
        { id: 'seed-INV-1042-2', date: daysAgo(12), kind: 'Contacted', text: 'Emailed; promised payment run next week.' },
      ] },
      { id: 'INV-1057', vendorId: 'v1', amount: 2310.5, due: daysAgo(33), status: 'Overdue', reminders: [
        { id: 'seed-INV-1057-1', date: daysAgo(18), kind: 'Contacted', text: 'Emailed reminder, no reply.' },
      ] },
      { id: 'INV-1063', vendorId: 'v2', amount: 15200, due: daysAgo(21), status: 'Overdue', reminders: [] },
      { id: 'INV-1071', vendorId: 'v6', amount: 4800, due: daysAgo(15), status: 'Overdue', reminders: [] },
      { id: 'INV-1078', vendorId: 'v3', amount: 960.75, due: daysAgo(9), status: 'Overdue', reminders: [] },
      { id: 'INV-1085', vendorId: 'v5', amount: 412.2, due: daysAgo(4), status: 'Overdue', reminders: [] },
      { id: 'INV-1090', vendorId: 'v4', amount: 3125, due: daysAgo(2), status: 'Overdue', reminders: [] },
    ],
  };
}
module.exports = { makeDemoData };
