'use strict';
// The steps left after setup, in the words of each app on a Mac. guided.js picks these lists when it runs on
// a Mac; each has the same shape as its Windows list there (steps, claudeSteps, antigravitySteps), and the Mac
// guides quote them. On a Mac the menus sit in the bar along the very top of the screen, next to the apple,
// and the first menu carries the app's own name and ends with Quit.
// Every name below was seen on a Mac (macOS 14, Intel) on 2026-11-23, in a from-nothing run of each app: see
// the note above each list. The folder window of all three apps has Desktop in its left list, shows the
// Desktop link Continuum Notes as a folder, and ends with Cancel and Open. Antigravity's folder window opened
// in Downloads, where the unzipped program folder is also named Continuum, so the steps name both wrong folders.
const folder = (vault, hasShortcut) => (vault && !hasShortcut
  ? 'Go to your notes folder and click Open. Your notes folder is ' + vault + '.'
  : 'In the left list click Desktop, click Continuum Notes once, then click Open.' +
    (vault ? ' (If you do not see Continuum Notes there, your notes folder is ' + vault + '.)' : '')) +
  ' Do not pick the folder named .continuum with a dot in front (that one only holds settings), and do not pick the Continuum folder in Downloads (that one is the program you unzipped).';

// The ChatGPT app (Codex lives inside it), version 26.1117: the bar reads ChatGPT, File, Edit, View, Window, Help;
// the ChatGPT menu holds Settings... and ends with Quit ChatGPT; File holds Open Folder...; the word Codex with a
// small arrow is at the top left of the window; after Open the app asked "Trust this folder?" with Trust folder and
// Cancel; Settings has a search box, and the Hooks page listed the notes folder with "6 need review" and Trust all;
// above the message box, This computer and the name of the notes folder.
const steps = (vault, hasShortcut) => [
  'In the bar at the very top of the screen click ChatGPT, then Quit ChatGPT. Then open the app again. (The red button in the corner only closes the window, so use Quit ChatGPT.)',
  'At the top left of the window, look at the word with the small arrow next to it. If it says ChatGPT, click it and pick Codex. If it already says Codex, go on to the next step.',
  'In the bar at the very top of the screen click File, then Open Folder. ' + folder(vault, hasShortcut) +
    ' If a box then asks Trust this folder?, check that it names your notes folder and click Trust folder.',
  'Open Settings: in the bar at the very top of the screen click ChatGPT, then Settings. (Another way: hold the Command key and press the comma key.) Type hooks in the search box and click Hooks. If that page does not show your notes folder, go back and open the other Hooks result. Click the row with your notes folder. If it says 6 need review, click Trust all. If it only says 6 hooks, they are already trusted from an earlier setup and there is nothing to click.',
  'Go back to the chat screen. Above the message box you should see the name of your notes folder and the words This computer. In a small window you may see two small pictures there instead of the words: a folder and a laptop. If it does not say This computer, click it and pick This computer.',
  'Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
// The Claude app, version 6.28899: the bar reads Claude, File, Edit, View, Go, Window, Help, and the Claude menu
// ends with Quit Claude; at the top left of the window, a speech bubble and </> side by side; + New at the top of
// the list on the left; under the message box, This computer and Choose folder, whose menu holds No folder and
// Open folder...; the folder window is titled Select folder; after Open the app asked "Trust this workspace?"
// with Cancel and Trust workspace.
const claudeSteps = (vault, hasShortcut) => [
  'Quit the Claude app completely, then open it again: in the bar at the very top of the screen click Claude, then click Quit Claude. ' +
    '(The red button in the corner only closes the window, so use Quit Claude.)',
  'At the top left of the Claude window there are two small pictures side by side. Click the one that looks like </> . That one is Code.',
  'Click + New at the top of the list on the left. Under the message box it should say This computer; if it says something else, click it and pick This computer. ' +
    'Next to it click Choose folder (if you used a folder before, the button shows that folder\'s name), then click Open folder... ' + folder(vault, hasShortcut) +
    ' If a box then asks Trust this workspace?, check that it names your notes folder and click Trust workspace.',
  'Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
// The Antigravity App 2.34.0: the bar reads Antigravity, File, Edit, View, Window (no Workspace menu on a Mac), and
// the Antigravity menu ends with Quit Antigravity; in the list on the left, next to the word Projects, a small
// folder picture with a plus sign (it shows "Create New Project" when the mouse rests on it) opens a small menu
// with New Project; the Create Project box has Add Folder, then Next; after Next the name of the notes folder is
// above the message box. Making the project made the Mac offer its "command line developer tools" (Antigravity
// looks for a program named git); Continuum does not use them.
const antigravitySteps = (vault, hasShortcut) => [
  'If Antigravity is open, quit it and open it again: in the bar at the very top of the screen click Antigravity, then click Quit Antigravity. Then open Antigravity again.',
  'Make your notes folder a project: in the list on the left, next to the word Projects, click the small folder picture with a plus sign, then click New Project, then Add Folder. ' +
    folder(vault, hasShortcut) + ' Then click Next. If your Mac then offers to install the command line developer tools, you can click Cancel: Continuum does not need them.',
  'The name of your notes folder is now above the message box. Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
module.exports = { steps, claudeSteps, antigravitySteps, STEPS: steps(), CLAUDE_STEPS: claudeSteps(), ANTIGRAVITY_STEPS: antigravitySteps() };
