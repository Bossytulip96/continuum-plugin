'use strict';
// The Mac side of the double-click setup: what a typed or dragged folder name means in Terminal, and the
// Desktop link named Continuum Notes. The words of the steps for each Mac app are in guided-mac-steps.js.
const fs = require('fs');
const os = require('os');
const path = require('path');

// In Terminal a folder dragged into the window arrives as /Users/sam/My\ Notes (each space and sign with a
// backslash before it, and often a space at the end), and ~ stands for the home folder. An answer the person
// put in quotes is taken as written, so a folder whose own name holds a backslash can still be named.
function typed(text) {
  let p = String(text).trim();
  const single = p.match(/^'([^']*)'$/);
  const double = p.match(/^"((?:\\.|[^"\\])*)"$/);
  if (single) p = single[1];
  else if (double) p = double[1].replace(/\\(["\\$`])/g, '$1');
  else p = p.replace(/^["']+|["']+$/g, '').trim().replace(/\\(.)/g, '$1');
  if (/^~(\/|$)/.test(p)) p = (process.env.HOME || os.homedir()) + p.slice(1);
  return p;
}
// Best effort: a link on the Desktop that opens the notes folder, so the folder is one click away in every
// "open folder" window. A link already there is pointed at the new notes folder only when it is one of ours:
// it opens a Continuum notes folder (one with START HERE.md), or a folder that is gone (the notes were moved).
// Anything else with that name (a real folder, a file, a link to some other folder) is left alone.
// CONTINUUM_DESKTOP overrides the Desktop folder so tests never touch the real one. True when the link is
// there and opens the notes folder.
function shortcut(vault, name, log) {
  try {
    const desktop = process.env.CONTINUUM_DESKTOP || path.join(process.env.HOME || os.homedir(), 'Desktop');
    const link = path.join(desktop, name);
    fs.mkdirSync(desktop, { recursive: true });
    let st = null;
    try { st = fs.lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st && !st.isSymbolicLink()) { log('shortcut not created: ' + link + ' exists and is not a link'); return false; }
    if (st) {
      const old = path.resolve(desktop, fs.readlinkSync(link));
      if (old === path.resolve(vault)) { log('shortcut already there: ' + link); return true; }
      if (fs.existsSync(old) && !fs.existsSync(path.join(old, 'START HERE.md'))) {
        log('shortcut not created: ' + link + ' is a link to another folder, ' + old); return false;
      }
      fs.unlinkSync(link);
    }
    fs.symlinkSync(path.resolve(vault), link, 'dir');
    log('shortcut created: ' + link);
    return true;
  } catch (e) { log('shortcut not created: ' + e.message); return false; }
}
module.exports = { typed, shortcut };
