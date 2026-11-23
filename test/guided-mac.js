'use strict';
// The Mac side of the guided setup that can be checked on any computer: the Mac guides for Codex and Claude
// against the steps in scripts/lib/guided-mac-steps.js, the nine .command files, and what a typed or dragged
// folder name means. (The Antigravity Mac guide is checked in test/antigravity-guided.js; the setup itself runs
// in test/guided-setup.js and test/antigravity-guided.js, which speak the Mac words when they run on a Mac.)
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const mac = require('../scripts/lib/guided-mac-steps');
const { render, GUIDES } = require('../scripts/build-guide');
let checks = 0;
function step(name, fn) { fn(); checks++; console.log('PASS guided-mac ' + checks + ': ' + name); }
const lf = text => text.replace(/\r\n/g, '\n');
// The page as a person reads it: no bold or code marks, the three escaped signs back, one space between words.
const plain = html => html.replace(/<\/?(?:strong|code)>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
function guideStep(app, steps) {
  const guide = GUIDES.find(g => path.basename(g.target) === 'Continuum Guide for ' + app + ' on a Mac.html');
  assert(guide, 'scripts/build-guide.js builds the Mac guide for ' + app);
  const source = path.basename(guide.source);
  // The zip carries only the HTML guide (the GUIDE-*.md sources are export-ignore), so there is nothing to compare there.
  if (!fs.existsSync(guide.source)) { console.log('SKIP guided-mac: ' + app + ' Mac HTML guide check, ' + source + ' is not here (an unzipped copy carries only the HTML)'); return; }
  step('the committed Mac HTML guide for ' + app + ' is what scripts/build-guide.js makes from ' + source + ', and it quotes the Mac steps', () => {
    const made = render(lf(fs.readFileSync(guide.source, 'utf8')), guide.title);
    assert.equal(lf(fs.readFileSync(guide.target, 'utf8')), made, 'run node scripts/build-guide.js');
    assert(made.includes('<title>' + guide.title + '</title>'));
    assert(!/<!--|\*\*|`|<script|https?:/.test(made.replace(/<code>[^<]*<\/code>/g, '')), 'no comment, stray mark, script or web address');
    // Words a first-time reader does not know, and the Mac's own names for its rule about files from the internet.
    assert(!/\bPATH\b|\bshell\b|symlink|quarantine|Gatekeeper/i.test(plain(made)), 'plain words only');
    // Every step whole, word for word, not only its first sentence.
    const text = plain(made);
    steps.forEach((s, i) => assert(text.includes(s.replace(/\s+/g, ' ')), 'step ' + (i + 1) + ' is not in the guide word for word: ' + s));
    assert(new RegExp('Part \\d+\\. \\w+ steps in ').test(text) && text.includes('Continuum Setup for ' + app + '.command'));
  });
}
try {
  assert.equal(mac.STEPS.length, 6); assert.equal(mac.CLAUDE_STEPS.length, 4); assert.equal(mac.ANTIGRAVITY_STEPS.length, 3);
  guideStep('Codex', mac.steps());
  guideStep('Claude', mac.claudeSteps());
  step('the nine Mac setup files: a first line #!/bin/sh, plain ASCII, LF line endings only, the right --host and flag, and the Node.js message', () => {
    const template = fs.readFileSync(path.join(root, 'Continuum Setup for Claude.command'), 'ascii');
    assert(fs.existsSync(path.join(root, 'scripts', 'guided-setup.js')));
    for (const app of ['Claude', 'Codex', 'Antigravity']) for (const kind of ['Setup', 'Check', 'Remove']) {
      const name = 'Continuum ' + kind + ' for ' + app + '.command';
      const bytes = fs.readFileSync(path.join(root, name));
      assert(bytes.every(b => b < 128), name + ' ASCII');
      const text = bytes.toString('ascii');
      assert.equal(text.split('\n')[0], '#!/bin/sh', name + ' first line');
      assert(!text.includes('\r'), name + ' LF line endings only');
      assert(text.endsWith('\n') && !/[ \t]\n/.test(text), name + ' ends with a line break, no spaces at a line end');
      const flag = kind === 'Setup' ? '' : ' --' + kind.toLowerCase();
      assert(text.includes(' scripts/guided-setup.js --host ' + app.toLowerCase() + flag + '\n'), name + ' host and flag');
      assert(text.includes('Continuum needs Node.js') && text.includes('nodejs.org/en/download'), name + ' Node.js message');
      assert(text.includes('You can close this window now.'), name);
      // One template: the nine files differ only in their name and in the host and flag they pass on.
      assert.equal(text, template.replace('Setup for Claude', kind + ' for ' + app).replace('--host claude', '--host ' + app.toLowerCase() + flag), name);
    }
  });
  step('Mac answers: ~ and a dragged folder', () => {
    const { typed } = require('../scripts/lib/guided-mac');
    assert.equal(typed('~/My Notes'), (process.env.HOME || os.homedir()) + '/My Notes');
    assert.equal(typed('/Users/sam/My\\ Notes '), '/Users/sam/My Notes');
    assert.equal(typed('/Users/sam/It\\\'s\\ here'), "/Users/sam/It's here");
    // In quotes the answer is taken as written: a folder's own name may hold a backslash.
    assert.equal(typed("'/Users/sam/A\\B'"), '/Users/sam/A\\B');
    assert.equal(typed('"/Users/sam/My Notes"'), '/Users/sam/My Notes');
    assert.equal(typed('"/Users/sam/A\\B"'), '/Users/sam/A\\B');
    assert.equal(typed('"/Users/sam/A\\B\\"C"'), '/Users/sam/A\\B"C');
  });
  step('a backup copy stays in its own batch folder: a file outside the notes folder is refused, a link is copied under its own name', () => {
    const { backup } = require('../scripts/action-gate');
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-macbackup-')));
    try {
      const vault = path.join(temp, 'vault'); fs.mkdirSync(path.join(vault, 'tmp'), { recursive: true });
      const outside = path.join(temp, 'tmp', 'note.md'); fs.mkdirSync(path.dirname(outside)); fs.writeFileSync(outside, 'outside');
      const inner = path.join(vault, 'tmp', 'note.md'); fs.writeFileSync(inner, 'a note of its own');
      const c = { vault, timezone: 'UTC' };
      assert.throws(() => backup(c, outside, 'batch-a'), /not inside the notes folder/);
      assert.equal(fs.readFileSync(inner, 'utf8'), 'a note of its own'); assert(!fs.existsSync(path.join(vault, '.backups')));
      if (process.platform === 'win32') return;
      const link = path.join(vault, 'link.md'); fs.symlinkSync(outside, link);
      backup(c, link, 'batch-b');
      const copies = fs.readdirSync(path.join(vault, '.backups'), { recursive: true }).map(String).filter(f => f.endsWith('.md'));
      assert.deepEqual(copies.map(f => f.split(path.sep).slice(1).join('/')), ['batch-b/link.md']);
      assert.equal(fs.readFileSync(inner, 'utf8'), 'a note of its own');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  step('the paths the gate reads from a command: $HOME, ${HOME}, and (outside Windows) backslash-space outside quotes only', () => {
    const { commandPaths } = require('../scripts/action-gate');
    const vault = path.join(os.homedir(), 'SampleVault');
    const named = cmd => commandPaths({ vault }, cmd, path.join(os.homedir(), 'elsewhere')).map(t => t.p);
    const note = path.join(vault, 'a.md');
    for (const cmd of ['rm ${HOME}/SampleVault/a.md', 'rm $HOME/SampleVault/a.md', 'rm "$HOME/SampleVault/a.md"', 'rm "${HOME}/SampleVault/a.md"', 'rm ~/SampleVault/a.md']) {
      assert(named(cmd).includes(note), cmd + ' -> ' + named(cmd).join(' | '));
    }
    if (process.platform === 'win32') return;
    assert(named('rm /x/My\\ note.md').includes('/x/My note.md'), 'a space written as backslash-space');
    assert(named("rm /x/It\\'s.md").includes("/x/It's.md"), 'an apostrophe written with a backslash');
    assert(named("rm '/x/A\\ B.md'").includes('/x/A\\ B.md'), 'single quotes keep the backslash');
    assert(named('rm "/x/A\\ B.md"').includes('/x/A\\ B.md'), 'double quotes keep the backslash');
    assert(!named("rm '/x/A\\ B.md'").includes('/x/A B.md'), 'and the name without it is not what the command names');
    assert(named('rm "/x/A\\\\B/note.md"').includes('/x/A\\B/note.md'), 'inside double quotes two backslashes are one');
    assert(named('rm "/x/say \\"hi\\".md"').includes('/x/say "hi".md'), 'and an escaped double quote is a double quote');
    assert(named("f='/x/kept.md'; rm \"$f\"").includes('/x/kept.md'), 'a quoted path inside an assignment is still collected');
    assert(named('rm /x/"my vault"/note.md').includes('/x/my vault/note.md'), 'pieces written next to each other are one word');
    assert(named("rm /x/'a b'/\"c d\"/e\\ f.md").includes('/x/a b/c d/e f.md'), 'whatever the mix of quotes');
    assert(named('rm "/x/cost\\$5.md"').includes('/x/cost$5.md'), 'an escaped dollar sign is part of the name');
    assert(named("rm '/x/cost$5.md'").includes('/x/cost$5.md'), 'so is one inside single quotes');
    assert(named('rm /x/cost\\$5.md').includes('/x/cost$5.md'), 'and one with a backslash outside quotes');
    assert(!named('rm "/x/$name.md"').some(p => p.includes('name.md')), 'a dollar sign the shell would act on names nothing the gate can know');
    assert(named('rm /x/a.md \\\n  /x/b.md').includes('/x/b.md'), 'a backslash at a line end only joins the lines');
    const home = process.env.HOME || os.homedir();
    assert(named('rm ${HOME}Suffix/a.md').includes(home + 'Suffix/a.md'), '${HOME} right before more of the name');
    assert(named('rm $HOME"Suffix/a.md"').includes(home + 'Suffix/a.md'), '$HOME right before a quoted piece');
    assert(!named('rm $HOMEWORK/a.md').some(p => p.endsWith('a.md')), '$HOMEWORK is another variable, which the gate cannot know');
    assert(named("rm '/x/${HOME}/a.md'").includes('/x/${HOME}/a.md'), 'inside single quotes ${HOME} is only a name');
    assert(named('rm /x/a{b}/note.md').includes('/x/a{b}/note.md'), 'a brace inside a word is part of the name');
    assert(!named('{ rm /x/a.md; }').some(p => /[{}]$/.test(p)), 'the lone braces of the shell are no path');
    for (const sign of ['', '', '', '']) {
      assert(named("rm '/x/" + sign + "/a.md'").includes('/x/' + sign + '/a.md'), 'a name that really holds the private sign U+' + sign.charCodeAt(0).toString(16));
      assert(named('rm /x/' + sign + '$5.md').length === 0 || !named('rm /x/' + sign + '$5.md').includes('/x/' + sign + '$5.md'), 'and an active $ next to it is still skipped');
    }
    assert(named('rm "/x/ab\\$c.md"').includes('/x/ab$c.md'), 'a private sign and an escaped dollar sign in one name');
    assert(named('rm $HO\\\nME/SampleVault/a.md').includes(note), 'a line break with a backslash before it inside $HOME');
    assert(named('rm "/x/a\\\nb.md"').includes('/x/ab.md'), 'the same join inside double quotes');
    assert(named("rm '/x/a\\\nb.md'").includes('/x/a\\\nb.md'), 'but not inside single quotes');
    assert(named('cd /x; rm -r \\{\\}').includes(path.resolve(path.join(os.homedir(), 'elsewhere'), '{}')), 'an escaped {} is a name, not the placeholder');
    const kept = process.env.HOME;
    try {
      process.env.HOME = ''; assert(named('rm "${HOME}/x/a.md"').includes('/x/a.md'), 'an empty HOME is empty');
      delete process.env.HOME; assert(named('rm "$HOME/x/a.md"').includes('/x/a.md'), 'and so is a HOME that is not set, as for the shell');
    } finally { process.env.HOME = kept; }
  });
  if (process.platform !== 'win32') step('the Desktop link: made, kept, moved with the notes, and never taken from another folder', () => {
    const { shortcut } = require('../scripts/lib/guided-mac');
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-maclink-')));
    const said = []; const log = t => said.push(t);
    const prev = process.env.CONTINUUM_DESKTOP; process.env.CONTINUUM_DESKTOP = path.join(temp, 'Desktop');
    try {
      const link = path.join(temp, 'Desktop', 'Continuum Notes');
      const [a, b, other] = ['Notes A', 'Notes B', 'Research'].map(n => path.join(temp, n));
      for (const d of [a, b, other]) fs.mkdirSync(d);
      for (const d of [a, b]) fs.writeFileSync(path.join(d, 'START HERE.md'), 'x');
      assert.equal(shortcut(a, 'Continuum Notes', log), true); assert.equal(fs.readlinkSync(link), a);
      assert.equal(shortcut(a, 'Continuum Notes', log), true); assert.match(said[said.length - 1], /already there/);
      assert.equal(shortcut(b, 'Continuum Notes', log), true); assert.equal(fs.readlinkSync(link), b); // a link to a notes folder is ours
      fs.rmSync(b, { recursive: true }); fs.mkdirSync(b); fs.writeFileSync(path.join(b, 'START HERE.md'), 'x');
      fs.unlinkSync(link); fs.symlinkSync(path.join(temp, 'gone'), link, 'dir');
      assert.equal(shortcut(a, 'Continuum Notes', log), true); assert.equal(fs.readlinkSync(link), a); // a link to a folder that is gone
      fs.unlinkSync(link); fs.symlinkSync(other, link, 'dir');
      assert.equal(shortcut(a, 'Continuum Notes', log), false); assert.equal(fs.readlinkSync(link), other); // somebody else's link
      fs.unlinkSync(link); fs.mkdirSync(link);
      assert.equal(shortcut(a, 'Continuum Notes', log), false); assert(fs.statSync(link).isDirectory()); // a real folder
    } finally {
      if (prev === undefined) delete process.env.CONTINUUM_DESKTOP; else process.env.CONTINUUM_DESKTOP = prev;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
  console.log('PASS guided-mac: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL guided-mac after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
}
