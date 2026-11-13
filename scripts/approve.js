'use strict';
const fs = require('fs');
const config = require('./lib/config');
const log = require('./decision-log');

const LEVELS = ['vendor-write', 'email-send', 'vault-delete', 'system-change', 'new-note'];
function approve(c, level, note) {
  note = String(note || '').trim();
  if (!LEVELS.includes(level) || !note) {
    throw new Error('usage: node approve.js <' + LEVELS.join('|') + '> "<what the person said>"');
  }
  const file = config.configFile(c, 'approvals.json');
  let data = {};
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid approvals file');
  }
  const issued = Date.now();
  const expires = issued + config.ttl(c);
  data[level] = { issued, expires, note };
  fs.mkdirSync(c.configDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log.append(c, 'action: approval', level, 'approved in chat', note);
  return expires;
}
module.exports = { approve, LEVELS };
if (require.main === module) config.runCli(() => {
  const c = config.load();
  const [level, ...words] = process.argv.slice(2);
  const expires = approve(c, level, words.join(' '));
  console.log('Approved ' + level + '; expires ' + new Date(expires).toISOString());
});
