@echo off
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
call npx agent-browser click "button:has-text('动态物理实验课件')"
call npx agent-browser wait 1000
call npx agent-browser click "button:has-text('发送想法')"
call npx agent-browser wait 8000
call npx agent-browser screenshot tutor_experiment_reply.png
call npx agent-browser eval "window.scrollTo(0, document.body.scrollHeight)"
call npx agent-browser wait 1000
call npx agent-browser screenshot tutor_experiment_reply_scrolled.png
