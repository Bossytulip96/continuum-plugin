'use strict';
// The sixth setup answer. smoke.js runs these against a throwaway Claude Code settings
// folder (CLAUDE_CONFIG_DIR), never the real one.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
module.exports = function setupCases({ run, setupArgs, temp, vault }) {
  const settings = path.join(temp, 'claude', 'settings.json');
  const kept = path.join(temp, 'config', 'claude-settings-before.json');
  const answer = value => [...setupArgs.slice(0, -1), value];
  const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
  // The question cannot be skipped, and a no touches nothing.
  assert.match(run('setup', setupArgs.slice(0, -2), undefined, undefined, 1).stderr, /allow-folder/);
  assert.match(run('setup', answer('maybe'), undefined, undefined, 1).stderr, /allow-folder/);
  assert.match(run('setup', setupArgs).stdout, /--add-dir/);
  assert(!fs.existsSync(settings));
  // A yes creates the file when it is missing, and saves no stray key in the config.
  assert.match(run('setup', answer('yes')).stdout, /Added the vault/);
  assert.deepEqual(read(), { permissions: { additionalDirectories: [vault] } });
  assert(!fs.readFileSync(path.join(temp, 'config', 'config.json'), 'utf8').includes('allow-folder'));
  // A second yes adds nothing; the same folder spelled another way counts as listed.
  assert.match(run('setup', answer('yes')).stdout, /already allows/);
  fs.writeFileSync(settings, JSON.stringify({ permissions: { additionalDirectories: [vault.split(path.sep).join('/') + '/'] } }));
  assert.match(run('setup', answer('yes')).stdout, /already allows/);
  assert.equal(read().permissions.additionalDirectories.length, 1);
  // Everything else in the file survives, and the file as it was is kept.
  const other = { model: 'sample', permissions: { allow: ['Read'], additionalDirectories: ['/elsewhere'] }, hooks: { Stop: [] } };
  fs.writeFileSync(settings, '﻿' + JSON.stringify(other));
  assert.match(run('setup', answer('yes')).stdout, /Added the vault/);
  assert.deepEqual(read(), { ...other, permissions: { allow: ['Read'], additionalDirectories: ['/elsewhere', vault] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(kept, 'utf8').replace(/^﻿/, '')), other);
  // A settings file that is not what setup expects is left exactly as it is.
  for (const odd of ['{broken', '[]', '{"permissions":[]}', '{"permissions":{"additionalDirectories":"x"}}']) {
    fs.writeFileSync(settings, odd);
    const output = run('setup', answer('yes')).stdout;
    assert.match(output, /Not added/); assert.match(output, /Config saved/);
    assert.equal(fs.readFileSync(settings, 'utf8'), odd);
  }
  fs.rmSync(path.join(temp, 'claude'), { recursive: true, force: true });
};
