'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InvoiceStore } = require('./data');
const { makeDemoData } = require('./demo-data');
const settings = { uri: 'bolt://test.invalid:7687', username: 'test', password: 'test-only', database: 'neo4j' };
function fakeDriver() {
  const graph = new Map(), calls = [];
  let sessions = 0, closedSessions = 0, closed = 0;
  const driver = {
    verifyConnectivity: async () => {},
    close: async () => { closed++; },
    session: () => {
      sessions++;
      const tx = { run: async (query, params = {}) => {
        calls.push({ query, params });
        if (query.includes('UNWIND $vendors')) {
          for (const invoice of params.invoices) {
            if (!graph.has(invoice.id)) graph.set(invoice.id, { ...structuredClone(invoice), vendor: structuredClone(params.vendors.find(v => v.id === invoice.vendorId)) });
          }
        }
        if (query.includes('MATCH (i:Invoice {id: $id})')) {
          const invoice = graph.get(params.id);
          if (!invoice) return { records: [] };
          invoice.status = 'Contacted';
          if (!invoice.reminders.some(r => r.id === params.reminderId)) invoice.reminders.push({ id: params.reminderId, date: params.date, createdAt: params.createdAt, kind: 'Contacted', text: params.text });
          return { records: [{ get: () => params.id }] };
        }
        if (query.includes('RETURN properties(v)')) return { records: [...graph.values()].map(i => ({ get: name => name === 'invoice' ? Object.fromEntries(Object.entries(i).filter(([k]) => !['vendor','reminders'].includes(k))) : name === 'vendor' ? structuredClone(i.vendor) : structuredClone(i.reminders) })) };
        return { records: [] };
      } };
      return { executeRead: work => work(tx), executeWrite: work => work(tx), close: async () => { closedSessions++; } };
    },
  };
  return { driver, calls, graph, counts: () => ({ sessions, closedSessions, closed }) };
}
test('missing configuration keeps seven invoices and full reviewed history in memory', async () => {
  const db = new InvoiceStore({});
  assert.equal((await db.initialize()).reason, 'not_configured');
  assert.equal((await db.list()).length, 7);
  const result = await db.markContacted('INV-1063', 'Reviewed message\nFull text retained.');
  assert.equal(result.status, 'Contacted');
  assert.equal((await db.get('INV-1063')).reminders.at(-1).text, 'Reviewed message\nFull text retained.');
  assert.equal((await new InvoiceStore({}).get('INV-1063')).status, 'Overdue');
});
test('failed connection closes driver and exposes only a safe status', async () => {
  const fake = fakeDriver();
  fake.driver.verifyConnectivity = async () => { throw new Error('private password connection detail'); };
  const db = new InvoiceStore(settings, { driverFactory: () => fake.driver });
  const status = await db.initialize();
  assert.equal(status.reason, 'unavailable');
  assert.ok(!JSON.stringify(status).includes('private'));
  assert.equal(fake.counts().closed, 1);
  assert.equal((await db.list()).length, 7);
});
test('Neo4j mode uses parameterized data, closes sessions, and preserves records across initialization', async () => {
  const fake = fakeDriver();
  const db = new InvoiceStore(settings, { driverFactory: () => fake.driver });
  assert.equal((await db.initialize()).mode, 'neo4j');
  assert.equal(fake.calls.filter(c => c.query.includes('CREATE CONSTRAINT')).length, 3);
  const maliciousText = "Thanks ' }) DETACH DELETE n //";
  await db.markContacted('INV-1063', maliciousText);
  const write = fake.calls.find(c => c.query.includes('MATCH (i:Invoice {id: $id})'));
  assert.equal(write.params.text, maliciousText);
  assert.ok(!write.query.includes(maliciousText));
  assert.ok(write.query.includes('$reminderId'));
  const originalDue = fake.graph.get('INV-1063').due;
  await db.seed();
  assert.equal(fake.graph.size, 7);
  assert.equal(fake.graph.get('INV-1063').due, originalDue);
  assert.equal((await db.get('INV-1063')).status, 'Contacted');
  assert.equal((await db.get('INV-1063')).reminders.length, 1);
  assert.match(fake.calls.find(c => c.query.includes('UNWIND $vendors')).query, /ON CREATE SET/);
  assert.equal(fake.counts().sessions, fake.counts().closedSessions);
  await db.close();
  assert.equal(fake.counts().closed, 1);
});
test('unknown write outcome is not silently replayed into fallback', async () => {
  const fake = fakeDriver();
  const db = new InvoiceStore(settings, { driverFactory: () => fake.driver });
  await db.initialize();
  fake.driver.session = () => ({ executeWrite: async () => { throw new Error('connection lost'); }, close: async () => {} });
  await assert.rejects(db.markContacted('INV-1063', 'Reminder'), /outcome is unknown/);
  assert.equal(db.status().mode, 'demo');
  assert.equal((await db.get('INV-1063')).reminders.length, 0);
});
test('seed IDs stay stable', () => {
  const a = makeDemoData(), b = makeDemoData();
  assert.deepEqual(a.invoices.map(i => i.id), b.invoices.map(i => i.id));
  assert.deepEqual(a.invoices.flatMap(i => i.reminders.map(r => r.id)), b.invoices.flatMap(i => i.reminders.map(r => r.id)));
});
