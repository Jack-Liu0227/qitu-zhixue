#!/usr/bin/env bash
set -e

# 1. Login as student
cat << 'JSON' > /tmp/student_login.json
{
  "email": "student@qtzx.local",
  "password": "student123"
}
JSON

echo "=== 1. Logging in as student@qtzx.local ==="
curl -s -X POST http://127.0.0.1:4100/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d @/tmp/student_login.json \
  -c /tmp/student_cookies.txt > /tmp/login_res.json
cat /tmp/login_res.json
echo ""

echo "=== 2. Fetching project-templates ==="
curl -s -X GET http://127.0.0.1:4100/api/v1/project-templates \
  -b /tmp/student_cookies.txt > /tmp/templates_res.json
cat /tmp/templates_res.json | jq .
echo ""

echo "=== 3. Testing Inspiration -> Confirm Project -> Tutor Opening Turn ==="
# Fetch the single published optics template version
TPL_VER_ID=$(cat /tmp/templates_res.json | jq -r '.data[0].latestPublishedVersionId')
echo "Optics Template Version ID: $TPL_VER_ID"

# Create exploration
cat << JSON > /tmp/create_exp.json
{
  "source": "recommended",
  "templateVersionId": "$TPL_VER_ID"
}
JSON

EXP_ID=$(curl -s -X POST http://127.0.0.1:4100/api/v1/explorations \
  -H "Content-Type: application/json" \
  -H "idempotency-key: verify-exp-$RANDOM" \
  -b /tmp/student_cookies.txt \
  -d @/tmp/create_exp.json | jq -r '.data.id')
echo "Exploration ID: $EXP_ID"

# Draft intent
cat << JSON > /tmp/draft_exp.json
{
  "goalUser": "探究光的路径：从反射定律到透镜成像",
  "coreInterests": ["物理光学"]
}
JSON
curl -s -X PATCH http://127.0.0.1:4100/api/v1/explorations/$EXP_ID \
  -H "Content-Type: application/json" \
  -b /tmp/student_cookies.txt \
  -d @/tmp/draft_exp.json > /dev/null

# Confirm intent
cat << JSON > /tmp/confirm_exp.json
{
  "templateVersionId": "$TPL_VER_ID"
}
JSON

CONFIRM_RES=$(curl -s -X POST http://127.0.0.1:4100/api/v1/explorations/$EXP_ID/confirm-intent \
  -H "Content-Type: application/json" \
  -H "idempotency-key: verify-confirm-$RANDOM" \
  -b /tmp/student_cookies.txt \
  -d @/tmp/confirm_exp.json)
PROJECT_ID=$(echo $CONFIRM_RES | jq -r '.data.project.id')
echo "Created Project ID: $PROJECT_ID"

# Initialize Tutor session for this project
cat << JSON > /tmp/create_session.json
{
  "projectId": "$PROJECT_ID",
  "source": "project"
}
JSON

SESSION_RES=$(curl -s -X POST http://127.0.0.1:4100/api/v1/tutor/sessions \
  -H "Content-Type: application/json" \
  -b /tmp/student_cookies.txt \
  -d @/tmp/create_session.json)
SESSION_ID=$(echo $SESSION_RES | jq -r '.data.sessionId')
echo "Tutor Session ID: $SESSION_ID"

# Get session turns (verify opening dialogue)
TURNS_RES=$(curl -s -X GET http://127.0.0.1:4100/api/v1/tutor/sessions/$SESSION_ID \
  -b /tmp/student_cookies.txt)
echo "=== Opening Turn Verification ==="
echo $TURNS_RES | jq '.data.turns[0].blocks'
echo ""
echo "Author:"
echo $TURNS_RES | jq '.data.turns[0].author'
