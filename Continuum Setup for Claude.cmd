@echo off
title Continuum Setup for Claude
setlocal
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=20?0:1)"
if errorlevel 1 goto nonode
node "%~dp0scripts\guided-setup.js" --host claude
goto end
:nonode
echo.
echo Continuum needs Node.js, version 20 or later. It is a free program from nodejs.org.
echo Open nodejs.org in your browser (not the Microsoft Store), download the version marked LTS
echo and install it with the default choices.
echo Then double-click this file again.
:end
echo.
pause
