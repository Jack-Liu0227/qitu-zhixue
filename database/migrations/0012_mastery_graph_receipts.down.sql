-- Controlled rollback only: this removes projection metadata, never mastery facts.
DROP TABLE IF EXISTS "mastery_graph_receipts";
