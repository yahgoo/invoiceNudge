'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { InvoiceStore } = require('./data');
const db = new InvoiceStore(config.neo4j);
const { answerQuestion } = require('./chat');

const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });
function templateDraft(inv) {
  const tone = inv.reminders.length ? 'I am following up on my earlier note' : 'I wanted to send a friendly reminder';
  return `Hi ${inv.vendor.contact.split(' ')[0]},\n\n${tone} that invoice ${inv.id} for ${money(inv.amount)} was due on ${inv.due} and is now ${inv.daysOverdue} days past due. Could you let me know when we can expect payment, or if anything is holding it up?\n\nIf it has already been sent, please disregard this message. Thank you for your help.\n\nBest regards`;
}
function send(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Invoice-Storage': db.status().mode });
  res.end(JSON.stringify(value));
}
async function body(req, limit = 50000) {
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Invalid request');
    text += chunk;
  }
  return JSON.parse(text || '{}');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(/^\/api\/invoices\/([\w-]+)(?:\/(draft|contacted))?$/);
  try {
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      let input;
      try { input = await body(req, 4096); }
      catch { return send(res, 400, { error: 'Send a valid JSON message with a body no larger than 4 KB.' }); }
      if (typeof input?.message !== 'string' || !input.message.trim() || input.message.length > 500)
        return send(res, 400, { error: 'Please ask a question of 1 to 500 characters.' });
      return send(res, 200, await answerQuestion(db, input.message));
    }
    if (url.pathname === '/api/status' && req.method === 'GET') return send(res, 200, db.status());
    if (url.pathname === '/api/invoices' && req.method === 'GET') return send(res, 200, await db.list());
    if (match) {
      const invoice = await db.get(match[1]);
      if (!invoice) return send(res, 404, { error: 'Invoice not found.' });
      if (!match[2] && req.method === 'GET') return send(res, 200, invoice);
      if (match[2] === 'draft' && req.method === 'POST') return send(res, 200, {
        text: templateDraft(invoice), source: 'template',
        status: 'Local template draft. No external AI service is used.',
      });
      if (match[2] === 'contacted' && req.method === 'POST') {
        let input;
        try { input = await body(req); } catch { return send(res, 400, { error: 'Invalid request body.' }); }
        if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 10000)
          return send(res, 400, { error: 'Please review a reminder of 1 to 10,000 characters.' });
        try {
          const updated = await db.markContacted(match[1], input.text.trim());
          return updated ? send(res, 200, updated) : send(res, 404, { error: 'Invoice not found.' });
        } catch {
          return send(res, 503, { error: 'Database connection lost during save. The save outcome is unknown. Reconnect and check history before trying again.' });
        }
      }
    }
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    return send(res, 404, { error: 'Not found.' });
  } catch {
    return send(res, 500, { error: 'The request could not be completed. Please refresh and try again.' });
  }
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => { await db.close(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', async () => {
  console.error('Server could not start. Check that the configured port is available.');
  await db.close();
  process.exitCode = 1;
});
(async () => {
  await db.initialize();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Invoice Nudge running at http://localhost:${config.port}`);
    console.log(db.status().message);
  });
})().catch(async () => { console.error('App initialization failed.'); await db.close(); process.exitCode = 1; });
