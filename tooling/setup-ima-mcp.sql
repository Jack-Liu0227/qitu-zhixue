-- Operator-only, idempotent registration. Secrets belong in /etc/qitu,
-- never in runtime_mcp_servers. Does not change any Agent model selection.
BEGIN;
INSERT INTO runtime_mcp_servers (id, label, transport, description, endpoint_origin, tool_ids, enabled, status, secret_ref)
VALUES ('ima-knowledge', 'ima 教材知识库', 'streamable_http', '共享高中数学、物理、化学教材；只读检索和原文读取',
  'http://127.0.0.1:8787', '["ima_list_knowledge_bases","ima_search_knowledge","ima_list_documents","ima_read_document"]',
  true, 'not_configured', 'env:QITU_IMA_MCP_TOKEN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_mcp_bindings (agent_id, mcp_server_id, allowed_tool_ids, enabled)
SELECT id, 'ima-knowledge', '["ima_list_knowledge_bases","ima_search_knowledge","ima_list_documents","ima_read_document"]'::jsonb, true
FROM agent_configs
WHERE enabled AND id IN ('qitu-learning-partner', 'interest-confirmation', 'project-recommender', 'learner-profile', 'growth-analyst', 'pbl-orchestrator')
ON CONFLICT (agent_id, mcp_server_id) DO NOTHING;

INSERT INTO audit_logs (id, action, target_type, target_id, detail, idempotency_key)
VALUES ('operator-ima-mcp-integration-v1', 'operator.mcp.register', 'runtime_mcp_server', 'ima-knowledge',
  '{"source":"operator-authorized-ima-integration","readOnly":true,"modelSelectionChanged":false}', 'operator-ima-mcp-integration-v1')
ON CONFLICT (idempotency_key) DO NOTHING;
COMMIT;
