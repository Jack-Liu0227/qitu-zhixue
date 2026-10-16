-- One-time compatibility migration for the already deployed shared Tutor.
-- Preserve its existing phase access; never enable a disabled assistant or
-- re-grant permissions after an administrator revokes them.
BEGIN;
WITH applied AS (
  INSERT INTO audit_logs (id, action, target_type, target_id, detail, idempotency_key)
  SELECT 'operator-ima-admin-v1', 'operator.mcp.ima.admin-migration', 'runtime_mcp_server', 'ima-knowledge',
    '{"preserveExistingPhaseAccess":true,"assistantEnabledChanged":false,"modelSelectionChanged":false}'::jsonb,
    'operator-ima-admin-v1'
  WHERE EXISTS (SELECT 1 FROM agent_mcp_bindings WHERE agent_id = 'qitu-learning-partner' AND mcp_server_id = 'ima-knowledge' AND enabled)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id
)
UPDATE admin_assistants
SET mcp_server_ids = mcp_server_ids || '["ima-knowledge"]'::jsonb, updated_at = now()
WHERE EXISTS (SELECT 1 FROM applied)
  AND NOT mcp_server_ids @> '["ima-knowledge"]'::jsonb
  AND id IN ('tutor-leader', 'fighter-concept-coach', 'fighter-code-guide', 'fighter-review-assessor',
    'kinetic-leader', 'kinetic-concept-coach', 'kinetic-experiment-guide', 'kinetic-review-assessor');
COMMIT;
