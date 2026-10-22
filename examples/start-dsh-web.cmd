@echo off
REM ===========================================================================
REM  Template restart command for dsh-auto-update.
REM
REM  The plugin never guesses how to start your web host: it runs THIS script
REM  after it has switched the launcher pointer to a new version. Copy the file
REM  somewhere stable (for example C:\tools\start-dsh-web.cmd), edit the two
REM  settings below, and point DSH_AUTO_UPDATE_LAUNCH_CMD at the copy.
REM
REM  Contract:
REM    * read by cmd.exe - keep it ASCII, keep CRLF line endings
REM    * start `dsh web` and exit; the updater polls /api/pair/status itself
REM    * write all output to a log file - the updater reads it to explain a
REM      failed boot instead of just saying "did not start"
REM    * switch to code page 65001 BEFORE reading install-base.txt, so that a
REM      non-ASCII install directory survives (see chcp below)
REM ===========================================================================
setlocal
chcp 65001 >nul

REM ---- settings -------------------------------------------------------------
set "DSH_HOME=C:\path\to\dsh-home"
set "PORT=3080"
REM ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "POINTER=%HERE%current-root.txt"
set "BASE_FILE=%HERE%install-base.txt"
set "LOG=%HERE%web-run.out.log"

REM The pointer holds a bare version tag (e.g. 0.2.0-rc.2). Installs live in
REM <base>\dsh-install-<tag>, which is why the tag - and never a path - is what
REM gets written: cmd.exe reads this file in the console code page, so a full
REM path would only survive if every launcher agreed on that code page.
REM
REM install-base.txt (optional, written by the plugin's "install directory"
REM setting) holds that base, UTF-8, and it may contain non-ASCII characters.
REM The chcp above is what makes that safe; without it cmd.exe decodes the bytes
REM at code page 936 and every "if exist" below fails silently. Absent means
REM "next to DSH_HOME", the default.
set "BASE="
if exist "%BASE_FILE%" for /f "usebackq delims=" %%b in ("%BASE_FILE%") do if not defined BASE set "BASE=%%b"
if defined BASE if not exist "%BASE%\" set "BASE="
if not defined BASE set "BASE=%DSH_HOME%\.."

set "TAG="
if exist "%POINTER%" for /f "usebackq delims=" %%t in ("%POINTER%") do if not defined TAG set "TAG=%%t"

set "DEFAULT_BASE=%DSH_HOME%\.."
set "ROOT="
if defined TAG set "ROOT=%BASE%\dsh-install-%TAG%"
if defined ROOT if not exist "%ROOT%\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT="
REM After a base switch the tagged version can still sit in the other base.
if not defined ROOT if defined TAG if /i not "%BASE%"=="%DEFAULT_BASE%" if exist "%DEFAULT_BASE%\dsh-install-%TAG%\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT=%DEFAULT_BASE%\dsh-install-%TAG%"
if not defined ROOT for /f "delims=" %%d in ('dir /b /ad /o-n "%BASE%\dsh-install-*" 2^>nul') do if not defined ROOT if exist "%BASE%\%%d\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT=%BASE%\%%d"
if not defined ROOT if /i not "%BASE%"=="%DEFAULT_BASE%" for /f "delims=" %%d in ('dir /b /ad /o-n "%DEFAULT_BASE%\dsh-install-*" 2^>nul') do if not defined ROOT if exist "%DEFAULT_BASE%\%%d\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT=%DEFAULT_BASE%\%%d"

if not defined ROOT (
    echo [start-dsh-web] no usable dsh install found in "%BASE%" or "%DEFAULT_BASE%" >> "%LOG%"
    exit /b 1
)

REM Inherited session variables make a second host think it is a child of the
REM first one; clear them so the new process starts clean.
set "DSH_SESSION_ID="
set "DSH_SESSION_JSONL="
set "DSH_WEB_URL="
set "DSH_PROFILE="
set "DSH_PROFILE_DIR="

echo [start-dsh-web] %DATE% %TIME% ROOT=%ROOT% >> "%LOG%"
call node "%ROOT%\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --no-open --port %PORT% >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
