@echo off
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
call npx agent-browser open http://122.51.130.204/login
call npx agent-browser wait 2000
call npx agent-browser fill "input[type='email']" "student@qtzx.local"
call npx agent-browser fill "input[type='password']" "student123"
call npx agent-browser click "button[type='submit']"
call npx agent-browser wait 3000
call npx agent-browser open http://122.51.130.204/student/tutor/proj-aed6070c-0b70-4367-b0f4-a465809c0e29
call npx agent-browser wait 4000
call npx agent-browser fill "textarea" "我想通过微观动态课件仿真，观察单缝衍射和散射条纹的实时变化规律。"
call npx agent-browser wait 1000
call npx agent-browser click "button[type='submit']"
call npx agent-browser wait 8000
call npx agent-browser screenshot tutor_chat_experiment.png
call npx agent-browser eval "window.scrollTo(0, document.body.scrollHeight)"
call npx agent-browser wait 1000
call npx agent-browser screenshot tutor_chat_experiment_scrolled.png
