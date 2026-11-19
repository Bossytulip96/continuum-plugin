'use strict';
// Finding notes: starter rules 10 to 12, the start text block for folders whose rules do not say it, the two
// router lines, and the Codex start-text budget. Every script runs as a real child process against throwaway
// folders made by setup.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-finding-'));
let checks = 0;
const step = (name, fn) => { fn(); checks++; console.log('PASS finding ' + checks + ': ' + name); };
const ctx = out => (out.hookSpecificOutput || {}).additionalContext || '';
const fm = (terms, pattern) => '---\ntype: reference\npattern: ' + pattern + '\nabout: Fixture\nwhen_to_use: "' + terms + '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n';
// One throwaway home, config and notes folder per name, made by that host's own setup.
function make(host, name = host) {
  const base = path.join(temp, name);
  const home = path.join(base, 'home');
  const vault = path.join(base, 'vault');
  const config = path.join(base, 'config', 'config.json');
  const env = { ...process.env, USERPROFILE: home, HOME: home, CONTINUUM_CONFIG: config, CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
    CODEX_HOME: path.join(base, 'codex-home'), CONTINUUM_DESKTOP: path.join(base, 'desktop') };
  delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
  const flag = host === 'claude' ? [] : ['--host', host];
  function run(script, args = [], input, expected = 0) {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script + '.js'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000,
      input: input === undefined ? '' : JSON.stringify(input), maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(r.error);
    if (expected !== null) assert.equal(r.status, expected, script + ' ' + args.join(' ') + ': ' + r.stderr + r.stdout);
    return r;
  }
  let session = 0;
  const hook = (script, extra = {}) => JSON.parse(run(script, flag, { session_id: name + '-' + (++session), transcript_path: path.join(base, 'rollout.jsonl'), cwd: vault,
    hook_event_name: script === 'session-start' ? 'SessionStart' : 'UserPromptSubmit', ...extra }).stdout);
  const p = rel => path.join(vault, ...rel.split('/'));
  const h = { host, vault, flag, run, hook, p, read: rel => fs.readFileSync(p(rel), 'utf8'),
    write: (rel, text) => { fs.mkdirSync(path.dirname(p(rel)), { recursive: true }); fs.writeFileSync(p(rel), text); },
    start: () => ctx(hook('session-start', { source: 'startup' })),
    ask: prompt => ctx(hook('prompt-route', { prompt })),
    limit: n => { const c = JSON.parse(fs.readFileSync(config, 'utf8')); const was = c.inject.maxNoteChars; c.inject.maxNoteChars = n; fs.writeFileSync(config, JSON.stringify(c)); return was; } };
  run('setup', [...flag, ...(host === 'hermes' ? ['--hermes-home', path.join(base, 'hermes-home')] : []),
    '--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no']);
  return h;
}
// A notes folder as an earlier version or another system made it: its own start page and rules, none of the 0.6.1 rules.
function older(h, pageExtra = '') {
  h.write('START HERE.md', fm('', 'start') + '# My own start page\n\nNothing about finding here.\n' + pageExtra);
  h.write('Knowledge/Working Agreements.md', fm('my rules', 'working-agreements') + '# Rules\n\n## Standing rules\n\n1. Be brief.\n2. Ask before sending mail.\n');
}
const BLOCK = '[continuum] Finding notes\n\nA note reaches you by its lookup words (when_to_use words in the message: it is loaded for you), by a link from another ' +
  'note (open it yourself) or by search (no lookup word, nothing loaded: search every note yourself). When the person asks about or refers to something the notes ' +
  'may hold, read each note in full and follow its links to the end (a note already read is an end) before you answer or state a fact. Then give the correct answer, or "I could not find a ' +
  'definite answer" with where you looked.';
const LOADED = '[continuum] Vault notes loaded for this message. Read each one in full, then follow its links and the other places it names ' +
  '(another note, a file, a live system, reading only) to the end of the path before you answer. One note read is not the notes checked.';
const NONE = '[continuum] No note matched this message, so none was loaded. If it asks about or refers to something the notes may hold, ' +
  'search every note yourself and read what you find in full before you answer.';
try {
  const claude = make('claude'); const codex = make('codex'); const hermes = make('hermes');
  step('starter rules 10, 11 and 12 are in both starter notes, numbered in order, and every host loads them at the start', () => {
    const wa = claude.read('Knowledge/Working Agreements.md');
    const page = claude.read('START HERE.md');
    for (const text of [wa, page]) {
      const numbers = text.match(/^## Standing rules\s*\r?\n([\s\S]*?)(?=^##\s)/m)[1].split(/\r?\n/).map(l => (l.match(/^(\d+)\.\s/) || [])[1]).filter(Boolean);
      assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => String(i + 1)));
    }
    assert.match(wa, /^10\. Read the whole note, then follow its links and the other places it names \(a note, a file, a live system, reading only\) to the end before answering; .*One note read is not the notes checked\. When no note was loaded and the person asks about or refers to something the notes may hold, search every note\.\r?$/m);
    assert.match(wa, /^11\. Check every place that holds the answer before stating a fact: .*Then give the correct answer, or "I could not find a definite answer" with where you looked\.\r?$/m);
    assert.match(wa, /^12\. Ask one direct question at a time, in one line, in the message itself, .*Reasons come only when the person asks\. .*never left as a statement\.\r?$/m);
    assert.match(page, /^10\. Read the whole note and follow its links to the end before answering\.\r?$/m);
    assert.match(page, /^11\. Check every place before stating a fact; when it is not there, say "I could not find a definite answer"\.\r?$/m);
    assert.match(page, /^12\. Ask one direct question at a time, in the message itself\.\r?$/m);
    assert.match(page, /A message with none of the phrases loads nothing; Claude then searches the notes itself\./);
    for (const h of [claude, codex, hermes]) {
      assert.match(h.start(), /\[continuum\] Standing rules\n\n1\. Plan[\s\S]*\n\n10\. Read the whole note, then follow[\s\S]*\n\n11\. Check every place that holds[\s\S]*\n\n12\. Ask one direct question/, h.host);
    }
  });
  step('a folder whose rules carry rules 10 and 11 gets no second copy; take either rule out and the block opens the start text', () => {
    for (const h of [claude, codex, hermes]) {
      assert(!h.start().includes('[continuum] Finding notes'), h.host + ': the starter rules already say it');
      assert(h.start().startsWith('[continuum] Start page'), h.host);
    }
    const wa = claude.read('Knowledge/Working Agreements.md');
    for (const gone of [/^10\. .*\r?\n/m, /^11\. .*\r?\n/m]) {
      claude.write('Knowledge/Working Agreements.md', wa.replace(gone, ''));
      assert(claude.start().startsWith(BLOCK + '\n\n[continuum] Start page'), 'a rule removed by the person (' + gone + '): the block is back');
    }
    claude.write('Knowledge/Working Agreements.md', wa);
  });
  step('a folder made before 0.6.1 gets the block first, once, on Claude Code, Codex and Hermes', () => {
    for (const h of [make('claude', 'older-claude'), make('codex', 'older-codex'), make('hermes', 'older-hermes')]) {
      older(h);
      const text = h.start();
      assert(text.startsWith(BLOCK + '\n\n[continuum] Start page\n\n'), h.host + ': ' + text.slice(0, 160));
      assert(text.includes('# My own start page') && text.includes('[continuum] Standing rules\n\n1. Be brief.\n\n2. Ask before sending mail.'));
      assert.equal(text.split('[continuum] Finding notes').length, 2, 'once');
      assert(!/\n10\. Read the whole note/.test(text), 'no starter rule is written into a folder that has its own');
      assert(BLOCK.length < 600, 'the block stays short: ' + BLOCK.length);
    }
  });
  step('rules kept in another layout (the whole note loads): the block shows unless that note says it', () => {
    const h = make('hermes', 'layout');
    older(h);
    h.write('Knowledge/Working Agreements.md', fm('my rules', 'working-agreements') + '# Rules\n\n## 1. Be brief\n\nKeep it short.\n');
    assert(h.start().startsWith(BLOCK), 'no such rule in the whole note');
    h.write('Knowledge/Working Agreements.md', fm('my rules', 'working-agreements') + '# Rules\n\n## 1. Check first\n\nSay "I could not find a definite answer" and where you looked.\n');
    assert(h.start().startsWith(BLOCK), 'one of the two sentences is not enough');
    h.write('Knowledge/Working Agreements.md', fm('my rules', 'working-agreements') + '# Rules\n\n## 1. Check first\n\nOne note read is not the notes checked. Say "I could not find a definite answer" and where you looked.\n');
    assert(!h.start().includes('[continuum] Finding notes'));
  });
  step('a too-large line still comes first, then the block, then the start page', () => {
    const h = make('claude', 'large');
    older(h, '\n## Extra\n\n' + 'more words on a line\n'.repeat(60));
    h.limit(600);
    const text = h.start();
    assert(text.startsWith('[continuum] Notes too large to load whole: ') && text.split('\n')[0].includes('START HERE.md ('), text.slice(0, 300));
    assert(text.indexOf(BLOCK) > 0 && text.indexOf(BLOCK) < text.indexOf('[continuum] Start page'));
  });
  step('routed notes come under the line that says to read each in full and follow its links, on every host', () => {
    for (const h of [claude, codex, hermes]) {
      h.write('Knowledge/Garden.md', fm('tomato bed, garden plan', 'garden') + '# Garden\n\nThe main note.\n\n## Subject notes\n\n- [[Garden Soil]]\n');
      h.write('Knowledge/Garden Soil.md', fm('soil mix', 'garden-soil') + '# Garden Soil\n\nCompost was added in May.\n');
      const text = h.ask('what did we decide for the tomato bed');
      assert(text.startsWith(LOADED + '\n\n--- Knowledge/Garden.md ---\n'), h.host + ': ' + text.slice(0, 200));
      assert(text.includes('- [[Garden Soil]]') && !text.includes('Compost was added'), 'a main note loads with its list; the subject note is reached by the link');
      assert.equal(text.split('[continuum] Vault notes loaded').length, 2, 'the line is said once, above all notes');
      assert(!text.includes('[continuum] No note was loaded'));
    }
  });
  step('a message that routes no note gets the search line, on every host; a one or two word message gets nothing', () => {
    for (const h of [claude, codex, hermes]) {
      // Hermes does not work from inside the notes folder, so its lines also say where the notes are.
      const none = h.host === 'hermes' ? NONE + '\n\n[continuum] Notes folder:\n' + h.vault : NONE;
      assert.equal(h.ask('that was an issue we both looked at last week'), none, h.host);
      assert.equal(h.ask('check the greenhouse'), none, h.host + ': three words');
      for (const short of ['ok', 'go ahead', 'thank you', 'Yes!', '  ']) assert.equal(h.ask(short), '', h.host + ': ' + JSON.stringify(short));
    }
    // A parked note does not count as loaded, so the search line is still said.
    claude.write('Knowledge/Old Plan.md', fm('harbor plan', 'old-plan').replace('status: active', 'status: parked') + '# Old Plan\n');
    assert.equal(claude.ask('what about the harbor plan'), NONE);
  });
  step('a routed note over the load limit keeps both the line above it and its own notice', () => {
    const was = claude.limit(400);
    claude.write('Knowledge/Long One.md', fm('long subject', 'long-one') + '# Long One\n\n' + 'a line of plain words here\n'.repeat(40));
    const text = claude.ask('tell me about the long subject');
    assert(text.startsWith(LOADED)); assert.match(text, /\[continuum\] This note is \d+ characters and only the first \d+ were loaded\. The rest is in the file Knowledge\/Long One\.md\./);
    claude.limit(was); fs.rmSync(claude.p('Knowledge/Long One.md'));
  });
  const codexLimit = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'codex-hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].additionalContextLimit;
  step('codex: a fresh notes folder with five past sessions fits the start text Codex loads, with room for the person\'s own rules', () => {
    const fresh = make('codex', 'codex-fresh');
    const bare = fresh.start();
    for (let i = 1; i <= 5; i++) {
      fresh.write('Log/sessions/2026-01-0' + i + ' sample codex s' + i + '.md', '---\ntype: "session"\npattern: "session-digest"\nabout: "' + ('A first message of ordinary length, about seventy characters long, number ' + i).slice(0, 70) +
        '"\nmachine: "sample-computer"\nhost: "codex"\nsession: "s' + i + '"\nstarted: "2026-01-0' + i + ' 09:00"\nupdated: "2026-01-0' + i + ' 09:30"\nstatus: "closed"\n---\n# Session digest\n');
    }
    const text = fresh.start();
    assert(text.includes('[continuum] Recent sessions (metadata only)') && text.length > bare.length + 600, 'five session lines are in the start text');
    assert(!text.includes('Codex loads only the first'), 'no cut line on a fresh folder');
    assert(text.length <= codexLimit - 1200, 'fresh Codex start text with five sessions is ' + text.length + ' of ' + codexLimit + '; at least 1200 must stay free');
    assert(text.indexOf('[continuum] Chat approval') > 0 && text.endsWith('loaded in this chat.'), 'the last block is whole');
    const status = fresh.run('status', ['--host', 'codex'], undefined, null).stdout;
    assert.match(status, /note sizes \(load limit 25000 characters\): none over the limit or close to it/);
    assert(!/codex start text:/.test(status), 'status does not report a start text over the limit');
    console.log('     codex fresh start text: ' + bare.length + ' of ' + codexLimit + ' characters; with five sessions: ' + text.length);
  });
  step('codex: when an older folder\'s start text is over the limit, the block is whole inside the part Codex keeps', () => {
    const h = make('codex', 'codex-over');
    older(h, '\n## A long section\n\n' + 'a line of ordinary words in a long start page\n'.repeat(260));
    const text = h.start();
    assert(text.length > codexLimit, 'the fixture is over the limit: ' + text.length);
    assert.match(text, /^\[continuum\] This start text is \d+ characters and Codex loads only the first \d+, so the end is missing\./);
    assert(text.slice(0, codexLimit).includes(BLOCK + '\n\n[continuum] Start page'), 'the whole block comes before the cut');
    assert(text.indexOf(BLOCK) < 1200, 'only the short warning line is ahead of it');
  });
  step('a new folder whose start text outgrows what the host keeps gets the block back, ahead of the start page', () => {
    for (const [host, name] of [['codex', 'grown-codex'], ['claude', 'grown-claude'], ['hermes', 'grown-hermes']]) {
      const h = make(host, name);
      assert(!h.start().includes('[continuum] Finding notes'), host + ': fits, so the rules carry it');
      h.write('START HERE.md', h.read('START HERE.md') + '\n## My own section\n\n' + 'a line of ordinary words the person added\n'.repeat(160));
      const text = h.start();
      assert(text.length > 10000 && /\n10\. Read the whole note, then follow/.test(text), host + ': over 10,000 characters, the rules still loaded further down');
      assert(text.slice(0, 10000).includes(BLOCK + '\n\n[continuum] Start page'), host + ': the block is whole inside the first 10,000 characters');
      assert.equal(text.split('[continuum] Finding notes').length, 2);
      if (host === 'codex') assert.match(text, /^\[continuum\] This start text is \d+ characters and Codex loads only the first 10000/);
      else assert(text.startsWith(BLOCK));
    }
  });
  step('the Codex rules file written by setup carries the finding lines for both cases', () => {
    const agents = codex.read('AGENTS.md');
    assert.match(agents, /read each loaded note in full, then follow its links and the other places it names \(reading only\) to the end of the path before answering/);
    assert.match(agents, /^- Finding: check every place that holds the answer before stating a fact\./m);
    assert.match(agents, /^B\. Route: .*in full\. Follow their links.*\(reading only\).*search every note\. Then give the correct answer, or "I could not find a definite answer" with where you looked\.\r?$/m);
  });
  console.log('PASS finding: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL finding after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
