#!/usr/bin/env node
'use strict';
const fs = require('fs');
const config = require('./lib/config');

const clean = value => String(value == null ? '' : value)
  .replace(/\s*\|\s*/g, ' / ').replace(/[\r\n]+/g, ' ').trim();

function append(c, area, level, status, text) {
  const when = config.stamp(c);
  const file = config.vaultPath(c, 'Log', `decisions-${c.machine}-${when.slice(0, 7)}.md`);
  fs.mkdirSync(config.vaultPath(c, 'Log'), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# Decisions (${c.machine}) ${when.slice(0, 7)}\n\nDate | area | level | outcome | text\n\n`, 'utf8');
  }
  fs.appendFileSync(file, `${when} | ${clean(area)} | ${clean(level)} | outcome: ${clean(status)} | ${clean(text)}\n`, 'utf8');
  return true;
}

module.exports = { append };
if (require.main === module) config.runCli(() => {
  const [area, level, status, text = ''] = process.argv.slice(2);
  if (!area || !level || !status) {
    throw new Error('usage: decision-log.js "<area>" "<level>" "<status>" "<text>"');
  }
  append(config.load(), area, level, status, text);
  console.log('logged');
});
