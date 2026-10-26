-- Destructive rollback: export commercial records before applying manually.
DROP TABLE auth_sessions;
DROP TABLE family_invitations;
DROP TABLE business_expenses;
DROP TABLE business_model_usage;
DROP TABLE business_tasks;
DROP TABLE business_orders;
DROP TABLE business_offers;
DROP TABLE business_settings;
