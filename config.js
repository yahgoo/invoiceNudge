'use strict';
const fs = require('node:fs');
const path = require('node:path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
if (process.env.NEO4J_CREDENTIALS_FILE) {
  for (const key of ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_DATABASE']) {
    if (!process.env[key]) delete process.env[key];
  }
  try { process.loadEnvFile(process.env.NEO4J_CREDENTIALS_FILE); }
  catch { console.warn('Neo4j credential file could not be loaded. Using available settings or demo mode.'); }
}
module.exports = {
  port: process.env.PORT || 3000,
  neo4j: {
    uri: process.env.NEO4J_URI || '',
    username: process.env.NEO4J_USERNAME || '',
    password: process.env.NEO4J_PASSWORD || '',
    database: process.env.NEO4J_DATABASE || undefined,
  },
};
