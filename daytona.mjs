import { Daytona, DaytonaNotFoundError } from '@daytona/sdk';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const config = require('./config');
const root = dirname(fileURLToPath(import.meta.url));
const name = process.env.DAYTONA_SANDBOX_NAME || 'invoice-nudge';
const action = process.argv[2] || 'deploy';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let client;
let stage = 'configuration';
class SetupError extends Error {}
function fail(message) { throw new SetupError(message); }
async function command(sandbox, text, cwd, timeout = 60) {
  const result = await sandbox.process.executeCommand(text, cwd, undefined, timeout);
  if (result.exitCode !== 0) fail(`Sandbox command failed during ${stage}. Output suppressed to protect credentials.`);
  return result.result;
}
async function main() {
  if (!['deploy', 'open', 'stop'].includes(action)) fail('Use deploy, open, or stop.');
  if (!process.env.DAYTONA_API_KEY) fail('Set a replacement DAYTONA_API_KEY privately in the ignored local .env, then rerun.');
  client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, requestTimeoutMs: 120000, otelEnabled: false });
  stage = 'sandbox lookup';
  let sandbox;
  try { sandbox = await client.get(name); }
  catch (error) {
    if (!(error instanceof DaytonaNotFoundError) || action !== 'deploy') throw error;
    if (process.env.DAYTONA_REQUIRE_EXISTING === '1') fail('The configured sandbox was not found. Deployment stopped without creating one.');
    const db = config.neo4j;
    if (!db.uri || !db.username || !db.password) fail('Configure Neo4j locally before creating the sandbox.');
    stage = 'private sandbox creation';
    sandbox = await client.create({
      name, language: 'javascript', image: 'node:22-bookworm', public: false,
      labels: { app: 'invoice-nudge', managedBy: 'invoice-nudge-deploy' },
      autoStopInterval: 60, autoDeleteInterval: -1,
      envVars: { PORT: '3000', NODE_ENV: 'production' },
    }, { timeout: 180 });
  }
  // Refuse to mutate an unrelated or publicly exposed sandbox with the same name.
  if (sandbox.labels?.managedBy !== 'invoice-nudge-deploy') fail('Sandbox name is in use by an unmanaged sandbox. Choose DAYTONA_SANDBOX_NAME.');
  if (sandbox.public) fail('Sandbox is public. Make this sandbox private in Daytona before continuing.');
  console.log(`Sandbox: ${sandbox.name} (${sandbox.id})`);
  if (action === 'stop') { stage = 'stop'; await sandbox.stop(); console.log('Sandbox stopped. Neo4j data is unchanged.'); return; }
  stage = 'sandbox start';
  if (sandbox.state !== 'started') await sandbox.start(120);
  if (action === 'deploy') {
    const db = config.neo4j;
    if (!db.uri || !db.username || !db.password) fail('Neo4j settings are incomplete locally.');
    stage = 'runtime validation';
    await command(sandbox, "node -e 'if(Number(process.versions.node.split(" + '"."' + ")[0])<22)process.exit(1)'", undefined);
    const home = await sandbox.getUserHomeDir();
    const remote = posix.join(home, 'invoice-nudge');
    stage = 'source upload';
    await sandbox.fs.createFolder(remote, '700');
    await sandbox.fs.createFolder(posix.join(remote, 'public'), '700');
    // Explicit allowlist: never upload .env, credential files, the SDK helper, or node_modules.
    const files = ['package.json', 'package-lock.json', 'server.js', 'config.js', 'data.js', 'demo-data.js', 'seed.js', 'chat.js', 'public/index.html'];
    await sandbox.fs.uploadFiles(files.map(file => ({ source: join(root, file), destination: posix.join(remote, file) })));
    stage = 'dependency installation';
    await command(sandbox, 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error', remote, 120);
    stage = 'server environment configuration';
    // Bolt requires the actual server-side password, not an HTTPS-only vault placeholder.
    // Send only these settings through Daytona's environment API, never shell commands/files.
    await sandbox.updateEnv({
      NEO4J_URI: db.uri, NEO4J_USERNAME: db.username, NEO4J_PASSWORD: db.password,
      NEO4J_DATABASE: db.database || '', PORT: '3000', NODE_ENV: 'production',
    }, { unset: ['NEO4J_CREDENTIALS_FILE', 'DAYTONA_API_KEY'] });
    stage = 'inside-sandbox Neo4j verification';
    await command(sandbox, 'node seed.js', remote, 90);
    console.log('Verified from inside sandbox: Neo4j connection, constraints, and idempotent seed.');
    stage = 'app session restart';
    const sessionId = 'invoice-nudge-app';
    const sessions = await sandbox.process.listSessions();
    if (sessions.some(session => session.sessionId === sessionId)) await sandbox.process.deleteSession(sessionId);
    await sandbox.process.createSession(sessionId);
    await sandbox.process.executeSessionCommand(sessionId, { command: `cd ${quote(remote)} && exec npm start`, runAsync: true, suppressInputEcho: true });
    stage = 'app readiness';
    const check = `const wait=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{for(let n=0;n<45;n++){try{const r=await fetch('http://127.0.0.1:3000/api/status');const s=await r.json();if(s.mode==='neo4j'){const rows=await(await fetch('http://127.0.0.1:3000/api/invoices')).json();if(!Array.isArray(rows)||!rows.length)throw Error();const draft=await(await fetch('http://127.0.0.1:3000/api/invoices/'+rows[0].id+'/draft',{method:'POST'})).json();if(draft.source!=='template'||!draft.text)throw Error();console.log('Verified: Neo4j-backed dashboard and local template draft.');return}}catch{}await wait(1000)}process.exit(1)})()`;
    console.log((await command(sandbox, `node -e ${quote(check)}`, remote, 60)).trim());
  }
  stage = 'protected preview verification';
  const preview = await sandbox.getPreviewLink(3000);
  const statusUrl = new URL('/api/status', preview.url);
  const response = await fetch(statusUrl, { headers: { 'X-Daytona-Preview-Token': preview.token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || (await response.json()).mode !== 'neo4j') fail('Private preview did not return a Neo4j-backed status.');
  const unauthenticated = await fetch(statusUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (unauthenticated.status !== 401 && unauthenticated.status !== 403) fail('Preview access control could not be confirmed.');
  console.log(`Private preview (authentication required): ${preview.url}`);
  if (action === 'open') {
    stage = 'short-lived browser preview';
    const signed = await sandbox.getSignedPreviewUrl(3000, 300);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    // Do not print or persist the signed URL: it grants temporary access.
    await new Promise((resolve, reject) => {
      const child = spawn(opener, [signed.url], { stdio: 'ignore' });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Browser open failed')));
    });
    console.log('Opened a private browser preview valid for 5 minutes. No token was printed or saved.');
  } else console.log('Run npm run daytona:open to open a short-lived authenticated browser preview.');
}
try { await main(); }
catch (error) {
  const safe = error instanceof SetupError;
  console.error(safe ? error.message : `Daytona operation failed during ${stage}. Check account permissions, credits, region, and network access. Provider details are suppressed to protect secrets.`);
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client[Symbol.asyncDispose](); }
    catch { console.error('Daytona client cleanup did not complete. Provider details suppressed.'); process.exitCode = 1; }
  }
}
