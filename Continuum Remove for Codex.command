#!/bin/sh
# Continuum Remove for Codex, on a Mac. Run it from Terminal: type sh and a space, drag this file into the Terminal window, press Return.
cd "$(dirname "$0")" || exit 1
NODE=""
for n in "$(command -v node 2>/dev/null)" /usr/local/bin/node /opt/homebrew/bin/node; do
  if [ -n "$n" ] && [ -x "$n" ] && "$n" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null; then NODE="$n"; break; fi
done
if [ -z "$NODE" ]; then
  echo
  echo "Continuum needs Node.js, version 20 or later. It is a free program from nodejs.org."
  echo "In your browser open nodejs.org/en/download, scroll down to the green button named macOS Installer (.pkg),"
  echo "click it, open the file it downloads and take the default choices. Your Mac asks for your password while it does that."
  echo "Then run this file again."
else
  "$NODE" scripts/guided-setup.js --host codex --remove
fi
echo
echo "You can close this window now."
