'use strict';
const config = require('./config');
const { InvoiceStore } = require('./data');
(async () => {
  const db = new InvoiceStore(config.neo4j);
  try {
    const status = await db.initialize();
    if (status.mode !== 'neo4j') {
      console.error('Neo4j initialization did not complete. Check local settings, database availability, and schema permissions.');
      process.exitCode = 1;
      return;
    }
    console.log('Neo4j initialized: constraints and demo seed applied without overwriting existing records.');
  } finally { await db.close(); }
})().catch(() => { console.error('Neo4j initialization failed. Check local configuration.'); process.exitCode = 1; });
