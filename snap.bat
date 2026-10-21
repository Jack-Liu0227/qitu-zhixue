@echo off
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
call npx agent-browser snapshot -i
