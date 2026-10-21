@echo off
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
call npx agent-browser open http://122.51.130.204/login
call npx agent-browser wait 2000
call npx agent-browser fill "input[type='email']" "student@qtzx.local"
call npx agent-browser fill "input[type='password']" "student123"
call npx agent-browser click "button[type='submit']"
call npx agent-browser wait 3000
call npx agent-browser open http://122.51.130.204/student/projects/proj-aed6070c-0b70-4367-b0f4-a465809c0e29?mode=learn
call npx agent-browser wait 4000
call npx agent-browser eval "document.querySelector('input[type=range]')?.scrollIntoView({block: 'center'})"
call npx agent-browser wait 2000
call npx agent-browser screenshot simulation_card.png
call npx agent-browser open http://122.51.130.204/student/tutor/proj-aed6070c-0b70-4367-b0f4-a465809c0e29
call npx agent-browser wait 4000
call npx agent-browser screenshot tutor_page.png
call npx agent-browser snapshot
