'use strict';
const neo4j = require('neo4j-driver');
const { randomUUID } = require('node:crypto');
const { makeDemoData } = require('./demo-data');

const constraints = [
  'CREATE CONSTRAINT vendor_id IF NOT EXISTS FOR (v:Vendor) REQUIRE v.id IS UNIQUE',
  'CREATE CONSTRAINT invoice_id IF NOT EXISTS FOR (i:Invoice) REQUIRE i.id IS UNIQUE',
  'CREATE CONSTRAINT reminder_id IF NOT EXISTS FOR (r:Reminder) REQUIRE r.id IS UNIQUE',
];
const listQuery = `MATCH (v:Vendor)-[:HAS_INVOICE]->(i:Invoice)
OPTIONAL MATCH (i)-[:HAS_REMINDER]->(r:Reminder)
WITH v, i, r ORDER BY r.date, r.createdAt, r.id
WITH v, i, collect(properties(r)) AS reminders
RETURN properties(v) AS vendor, properties(i) AS invoice, reminders
ORDER BY invoice.due, invoice.id`;
const seedQuery = `UNWIND $vendors AS row
MERGE (v:Vendor {id: row.id})
ON CREATE SET v.name = row.name, v.contact = row.contact
WITH count(*) AS vendorsCreated
UNWIND $invoices AS row
MATCH (v:Vendor {id: row.vendorId})
MERGE (i:Invoice {id: row.id})
ON CREATE SET i.vendorId = row.vendorId, i.amount = row.amount,
              i.due = row.due, i.status = row.status
MERGE (v)-[:HAS_INVOICE]->(i)
FOREACH (entry IN row.reminders |
  MERGE (r:Reminder {id: entry.id})
  ON CREATE SET r.date = entry.date, r.kind = entry.kind,
                r.text = entry.text, r.createdAt = entry.date + 'T00:00:00.000Z'
  MERGE (i)-[:HAS_REMINDER]->(r)
)
RETURN count(i) AS invoices`;
const contactQuery = `MATCH (i:Invoice {id: $id})
SET i.status = 'Contacted'
MERGE (r:Reminder {id: $reminderId})
ON CREATE SET r.date = $date, r.createdAt = $createdAt,
              r.kind = 'Contacted', r.text = $text
MERGE (i)-[:HAS_REMINDER]->(r)
RETURN i.id AS id`;
const daysOverdue = due => Math.max(0, Math.floor((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(due)) / 864e5));
function decorate(invoice) {
  const result = structuredClone(invoice);
  result.daysOverdue = daysOverdue(result.due);
  const last = result.reminders.at(-1);
  result.nextAction = result.status === 'Paid' ? 'None'
    : result.status === 'Contacted' && last && daysOverdue(last.date) < 3 ? 'Await reply · follow up in 3 days'
    : !result.reminders.length ? (result.daysOverdue > 30 ? 'Send firm reminder today' : 'Send first reminder')
    : result.reminders.length >= 2 ? 'Escalate: call vendor contact' : 'Send follow-up';
  return result;
}
function demoInvoices() {
  const { vendors, invoices } = makeDemoData();
  return invoices.map(i => ({ ...i, vendor: vendors.find(v => v.id === i.vendorId) }));
}
class InvoiceStore {
  constructor(settings, { driverFactory = neo4j.driver } = {}) {
    this.settings = settings;
    this.driverFactory = driverFactory;
    this.driver = null;
    this.mode = 'demo';
    this.reason = 'not_configured';
    this.cache = demoInvoices();
  }
  status() {
    return { mode: this.mode, reason: this.reason, persistent: this.mode === 'neo4j', message:
      this.mode === 'neo4j' ? 'Neo4j connected · Status and history are saved in the database.'
        : this.reason === 'not_configured' ? 'Demo mode · Neo4j is not configured. Changes last until server restart.'
        : 'Demo mode · Neo4j is unavailable. Changes are temporary and are not synced. Restart after checking your connection.' };
  }
  async session(work, write = false) {
    const session = this.driver.session(this.settings.database ? { database: this.settings.database } : {});
    try {
      return await (write ? session.executeWrite(tx => work(tx), { timeout: 5000 })
        : session.executeRead(tx => work(tx), { timeout: 5000 }));
    } finally { await session.close(); }
  }
  async seed() {
    // Fixed schema identifiers; all record values are passed as query parameters.
    for (const query of constraints) await this.session(tx => tx.run(query), true);
    const sample = makeDemoData();
    await this.session(tx => tx.run(seedQuery, sample), true);
  }
  async readGraph() {
    const result = await this.session(tx => tx.run(listQuery));
    return result.records.map(record => ({
      ...record.get('invoice'), vendor: record.get('vendor'), reminders: record.get('reminders'),
    }));
  }
  async initialize() {
    const { uri, username, password } = this.settings;
    if (!uri || !username || !password) return this.status();
    try {
      this.driver = this.driverFactory(uri, neo4j.auth.basic(username, password), {
        connectionTimeout: 4000, connectionAcquisitionTimeout: 5000,
        maxTransactionRetryTime: 1000, disableLosslessIntegers: true,
        logging: { level: 'error', logger: () => {} },
      });
      await this.driver.verifyConnectivity();
      await this.seed();
      this.cache = await this.readGraph();
      this.mode = 'neo4j';
      this.reason = 'connected';
    } catch {
      await this.fallback();
    }
    return this.status();
  }
  async fallback() {
    this.mode = 'demo';
    this.reason = 'unavailable';
    await this.close();
  }
  async list() {
    if (this.mode === 'neo4j') {
      try { this.cache = await this.readGraph(); }
      catch { await this.fallback(); }
    }
    return this.cache.map(decorate).sort((a, b) => b.daysOverdue - a.daysOverdue || a.id.localeCompare(b.id));
  }
  async queryChat({ intent, invoiceId = '', vendor = '' }) {
    if (this.mode !== 'neo4j' || !this.driver) throw new Error('Database unavailable');
    const query = `MATCH (v:Vendor)-[:HAS_INVOICE]->(i:Invoice)
WHERE ($invoiceId = '' OR i.id = $invoiceId)
  AND ($vendor = '' OR toLower(v.name) CONTAINS toLower($vendor))
  AND (NOT $outstanding OR i.status <> 'Paid')
  AND (NOT $priority OR date(i.due) < date())
WITH v, i,
  CASE WHEN $priority THEN i.amount * duration.inDays(date(i.due), date()).days ELSE 0 END AS score
ORDER BY score DESC, i.due, i.id LIMIT 51
OPTIONAL MATCH (i)-[:HAS_REMINDER]->(r:Reminder)
WITH v, i, score, r ORDER BY r.date, r.createdAt, r.id
WITH v, i, score, collect(properties(r)) AS history
RETURN properties(v) AS vendor, properties(i) AS invoice, history[-20..] AS reminders
ORDER BY score DESC, invoice.due, invoice.id`;
    const result = await this.session(tx => tx.run(query, {
      invoiceId, vendor, outstanding: ['outstanding', 'priority'].includes(intent), priority: intent === 'priority',
    }));
    return result.records.map(record => decorate({ ...record.get('invoice'), vendor: record.get('vendor'), reminders: record.get('reminders') }));
  }
  async get(id) { return (await this.list()).find(i => i.id === id) || null; }
  async markContacted(id, text) {
    const reminder = { id: randomUUID(), date: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(), kind: 'Contacted', text };
    if (this.mode === 'neo4j') {
      try {
        const result = await this.session(tx => tx.run(contactQuery, {
          id, text, reminderId: reminder.id, date: reminder.date, createdAt: reminder.createdAt,
        }), true);
        if (!result.records.length) return null;
      } catch {
        await this.fallback();
        // A lost connection can hide a committed write. Never replay it in the demo store.
        throw new Error('Connection lost during save. Save outcome is unknown; reconnect and check history before trying again.');
      }
    }
    const invoice = this.cache.find(i => i.id === id);
    if (!invoice) return null;
    invoice.status = 'Contacted';
    invoice.reminders.push(reminder);
    return decorate(invoice);
  }
  async close() {
    const driver = this.driver;
    this.driver = null;
    if (driver) { try { await driver.close(); } catch {} }
  }
}
module.exports = { InvoiceStore };
