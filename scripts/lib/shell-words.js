'use strict';
// The words of a shell command, for the gate (action-gate.js commandPaths): every word, and every quoted
// string on its own as well.
// On Windows nothing is unescaped (a backslash is the folder separator) and the two patterns below are the ones
// the gate has always used.
// Everywhere else the command is read sign by sign, the way zsh and sh build a word: pieces written next to
// each other are one word (/notes/"my vault"/a.md), outside quotes a backslash keeps the next sign (My\ note.md),
// inside single quotes everything is as written, inside double quotes only \\ \" \$ and \` lose their backslash.
// A word ends at an unquoted blank, ; | & ( or ). A brace inside a word is an ordinary sign (a{b}/note.md);
// the lone words { } and {}, when nothing in them is quoted or escaped, are the shell's own and are left out.
// The gate must tell a $ or backquote the shell would act on from one that is part of a name, and it must put
// the home folder where the command says ${HOME} or $HOME. So until the gate has looked, those three travel as
// private signs: DOLLAR and BACKQUOTE for the ones that are part of a name (escaped, or inside single quotes),
// HOMEDIR for the home folder. A private sign that is really in a name travels with ESCAPE before it, so
// nothing is mistaken for something else. literal() turns a word back into the path the shell would use.
const SH = process.platform !== 'win32';
const ESCAPE = '';
const DOLLAR = '';
const BACKQUOTE = '';
const HOMEDIR = '';
const plain = text => text.replace(/[-]/g, sign => ESCAPE + sign);
const keep = text => plain(text).replace(/\$/g, DOLLAR).replace(/`/g, BACKQUOTE);
// What the shell itself would put there: the value of HOME, and nothing when HOME is empty or not set.
const homeFolder = () => process.env.HOME ?? '';
const decode = value => value.replace(/([-])|[-]/g, (sign, escaped) =>
  escaped || (sign === DOLLAR ? '$' : sign === BACKQUOTE ? '`' : homeFolder()));
const literal = value => SH ? decode(value) : value;
function windowsWords(text) {
  const command = text.replace(/\$\{HOME\}/g, '$HOME'); // Git Bash on Windows: ${HOME} is $HOME, and the braces would cut the word
  const values = [];
  const rx = /"([^"]*)"|'([^']*)'|([^\s;|&(){}]+?)(?=\s|[;|&(){}]|$)/g;
  let m;
  while ((m = rx.exec(command))) values.push(m[1] ?? m[2] ?? m[3]);
  // A quoted path can sit inside an assignment (f="/c/vault/note.md"; rm "$f"), where the pass above only
  // sees f="/c/vault/note.md, so every quoted string is collected on its own as well.
  const quoted = /"([^"]+)"|'([^']+)'/g;
  while ((m = quoted.exec(command))) values.push(m[1] ?? m[2]);
  return values;
}
// A backslash right before a line break joins the two lines, everywhere but inside single quotes, and the shell
// does that before it reads anything else (so $HO, a backslash, a line break and ME is $HOME). It is done first
// here too. Any other backslash stays with the sign after it, so two backslashes before a line break join nothing.
function joined(text) {
  let out = '';
  let single = false;
  let double = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && !single) {
      if (text[i + 1] !== '\n') out += ch + (text[i + 1] || '');
      i++; continue;
    }
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single) double = !double;
    out += ch;
  }
  return out;
}
// ${HOME}, or $HOME when the name ends there ($HOMEWORK is another variable): how many signs it takes, else 0.
function home(command, i) {
  if (command.startsWith('${HOME}', i)) return 7;
  return command.startsWith('$HOME', i) && !/[A-Za-z0-9_]/.test(command[i + 5] || '') ? 5 : 0;
}
function shWords(text) {
  const command = joined(text);
  const values = [];
  const pieces = []; // every quoted piece on its own as well, for f="/vault/note.md"; rm "$f"
  let word = '';
  let open = false; // a word has begun
  let bare = true; // nothing in the word was quoted or escaped: only then can { } or {} be the shell's own
  const end = () => {
    if (open && word && !(bare && /^(?:[{}]|\{\})$/.test(word))) values.push(word);
    word = ''; open = false; bare = true;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const h = home(command, i);
    if (h) { word += HOMEDIR; open = true; i += h - 1; continue; }
    if (ch === '\\') { // keeps the next sign
      if (i + 1 < command.length) { word += keep(command[i + 1]); open = true; bare = false; }
      i++; continue;
    }
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      const piece = keep(command.slice(i + 1, close < 0 ? command.length : close));
      word += piece; open = true; bare = false; if (piece) pieces.push(piece);
      i = close < 0 ? command.length : close; continue;
    }
    if (ch === '"') {
      let piece = '';
      for (i++; i < command.length && command[i] !== '"'; i++) {
        const inner = home(command, i);
        if (inner) { piece += HOMEDIR; i += inner - 1; continue; }
        if (command[i] === '\\' && /[\\"$`]/.test(command[i + 1] || '')) { i++; piece += keep(command[i]); continue; }
        piece += plain(command[i]);
      }
      word += piece; open = true; bare = false; if (piece) pieces.push(piece);
      continue;
    }
    if (/[\s;|&()]/.test(ch)) { end(); continue; }
    word += plain(ch); open = true;
  }
  end();
  return values.concat(pieces);
}
const words = text => SH ? shWords(String(text)) : windowsWords(String(text));
module.exports = { words, literal, shWords, windowsWords, decode };
