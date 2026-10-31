'use strict';
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const help = 'I can list outstanding invoices, prioritize follow-ups, check an invoice status, or show follow-up history. Try “What should I follow up on first?” or include an invoice number such as INV-1063.';
function parseQuestion(message) {
  const text = message.trim().replace(/[’]/g, "'");
  if (/\b(mark|delete|remove|update|create|send|pay|contact|change|set)\b/i.test(text)) return { intent: 'unsupported' };
  const ids = [...new Set((text.match(/\bINV-[A-Z0-9-]+\b/gi) || []).map(id => id.toUpperCase()))];
  if (ids.length > 1) return { intent: 'clarify', answer: 'Please ask about one invoice at a time.' };
  const history = /\b(history|follow[- ]?ups?)\b/i.test(text) && !/\b(first|prioriti[sz]e|priority)\b/i.test(text);
  if (history) {
    if (ids.length) return { intent: 'history', invoiceId: ids[0] };
    const match = text.match(/\b(?:history|follow[- ]?ups?)\s+(?:for|of)\s+(.+?)\s*[?.!]*$/i);
    const vendor = match?.[1].replace(/^(?:vendor\s+|invoice\s+)/i, '').replace(/[?.!]+$/, '').replace(/^["']|["']$/g, '').trim();
    if (!vendor) return { intent: 'clarify', answer: 'Which vendor or invoice should I show history for? Please give a vendor name or an invoice number.' };
    return { intent: 'history', vendor };
  }
  if (/\b(first|prioriti[sz]e|priority|urgent)\b/i.test(text) && /\b(invoice|follow|overdue|priority|prioriti[sz]e)\b/i.test(text)) return { intent: 'priority' };
  if (ids.length && /\b(status|invoice|inv-)\b/i.test(text)) return { intent: 'status', invoiceId: ids[0] };
  if (/\b(outstanding|unpaid|overdue)\b/i.test(text) && /\b(invoice|invoices|which|show|list)\b/i.test(text)) return { intent: 'outstanding' };
  if (/\bstatus\b/i.test(text)) return { intent: 'clarify', answer: 'Which invoice? Please include its full number, for example INV-1063.' };
  return { intent: 'unsupported' };
}
function summary(i) {
  const last = i.reminders.at(-1);
  const excerpt = last ? String(last.text).replace(/\s+/g, ' ').trim() : '';
  const latestText = excerpt.length > 180 ? excerpt.slice(0, 180) + '… (excerpt; ask for history)' : excerpt;
  return `${i.id} · ${i.vendor.name} · ${money(i.amount)} · ${i.daysOverdue} days overdue · ${i.status}\nLatest follow-up: ${last ? `${last.date} · ${last.kind}: ${latestText}` : 'None recorded.'}`;
}
async function answerQuestion(db, message) {
  const parsed = parseQuestion(message);
  if (parsed.intent === 'unsupported') return { source: 'help', answer: help };
  if (parsed.intent === 'clarify') return { source: 'clarification', answer: parsed.answer };
  let rows;
  try { rows = await db.queryChat(parsed); }
  catch { return { source: 'unavailable', answer: 'Neo4j is unavailable, so I cannot verify current invoice facts. The dashboard may still show demo or cached data, but I will not use it to answer. Check the database connection and restart the app if it is in demo mode.' }; }
  if (!rows.length) return { source: 'neo4j', answer: parsed.invoiceId || parsed.vendor ? 'No matching record was found in Neo4j. Please check the full invoice number or vendor name.' : 'No matching outstanding invoices were found in Neo4j.' };
  if (parsed.vendor) {
    const vendors = [...new Map(rows.map(i => [i.vendor.id, i.vendor.name])).values()];
    if (vendors.length > 1) return { source: 'neo4j', answer: `That vendor reference matches more than one vendor: ${vendors.join('; ')}. Please give the full vendor name or a specific invoice number.` };
  }
  const truncated = rows.length > 50;
  rows = rows.slice(0, 50);
  let heading;
  if (parsed.intent === 'priority') {
    rows.sort((a, b) => b.amount * b.daysOverdue - a.amount * a.daysOverdue || b.amount - a.amount || b.daysOverdue - a.daysOverdue || a.id.localeCompare(b.id));
    rows = rows.slice(0, 5);
    heading = 'Follow up in this order (top 5). Ranked by amount × days overdue, highest first, so larger balances and older debts rise to the top. Contacted invoices remain outstanding; check the latest follow-up before sending another reminder.';
  } else if (parsed.intent === 'outstanding') heading = 'Outstanding invoices in Neo4j (Paid invoices excluded):';
  else if (parsed.intent === 'history') heading = 'Recorded follow-up history in Neo4j (oldest to newest; up to 20 latest entries per invoice):';
  else heading = 'Current invoice status in Neo4j:';
  const entries = rows.map((i, index) => {
    let text = (parsed.intent === 'priority' ? `${index + 1}. ` : '') + summary(i);
    if (parsed.intent === 'history') text += '\nHistory:\n' + (i.reminders.length ? i.reminders.map(r => `${r.date} · ${r.kind}: ${r.text}`).join('\n') : 'No follow-ups recorded.');
    return text;
  });
  return { source: 'neo4j', answer: heading + '\n\n' + entries.join('\n\n') + (truncated ? '\n\nResults limited to 50 invoices. Please narrow your question.' : '') };
}
module.exports = { parseQuestion, answerQuestion };
