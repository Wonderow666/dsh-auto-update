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
REM ===========================================================================
setlocal

REM ---- settings -------------------------------------------------------------
set "DSH_HOME=C:\path\to\dsh-home"
set "PORT=3080"
REM ---------------------------------------------------------------------------

set "HERE=%~dp0"
set "POINTER=%HERE%current-root.txt"
set "LOG=%HERE%web-run.out.log"

REM The pointer holds a bare version tag (e.g. 0.2.0-rc.2). Installs live next
REM to DSH_HOME in directories named dsh-install-<tag>, which is why the tag -
REM and never a path - is what gets written: cmd.exe reads this file in the OEM
REM code page, so a non-ASCII path would come back as mojibake.
set "BASE=%DSH_HOME%\.."
set "TAG="
if exist "%POINTER%" for /f "usebackq delims=" %%t in ("%POINTER%") do set "TAG=%%t"

set "ROOT="
if defined TAG if exist "%BASE%\dsh-install-%TAG%\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT=%BASE%\dsh-install-%TAG%"
if not defined ROOT for /f "delims=" %%d in ('dir /b /ad /o-n "%BASE%\dsh-install-*" 2^>nul') do if not defined ROOT if exist "%BASE%\%%d\node_modules\@deepseek-ai\dsh\lib\bin.js" set "ROOT=%BASE%\%%d"

if not defined ROOT (
    echo [start-dsh-web] no usable dsh install found next to "%DSH_HOME%" >> "%LOG%"
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
