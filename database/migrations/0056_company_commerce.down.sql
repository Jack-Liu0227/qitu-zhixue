-- Refuse rollback while any Company or subscription data would be discarded.
BEGIN;
DO $$
DECLARE
  relation_name text;
  has_records boolean;
BEGIN
  LOCK TABLE business_orders IN ACCESS EXCLUSIVE MODE;
  FOREACH relation_name IN ARRAY ARRAY[
    'company_messages', 'company_channels', 'company_work', 'company_knowledge',
    'company_teams', 'company_members', 'commerce_usage', 'commerce_project_access',
    'commerce_grants', 'commerce_organizations', 'commerce_policies', 'commerce_products'
  ] LOOP
    IF to_regclass(relation_name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', relation_name);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[
    'company_messages', 'company_channels', 'company_work', 'company_knowledge',
    'company_teams', 'company_members', 'commerce_usage', 'commerce_project_access',
    'commerce_grants', 'commerce_organizations', 'commerce_policies', 'commerce_products'
  ] LOOP
    IF to_regclass(relation_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', relation_name) INTO has_records;
      IF has_records THEN
        RAISE EXCEPTION 'Cannot roll back 0056: % contains records; preserve and migrate them first', relation_name;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'business_orders' AND column_name = 'subscription'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM business_orders
      WHERE subscription IS NOT NULL OR service_starts_at IS NOT NULL OR refund_amount_fen IS NOT NULL
        OR student_id IS NULL OR offer_id IS NULL OR template_version_id IS NULL OR offer_snapshot IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot roll back 0056: extended orders exist; preserve and migrate them first';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS company_messages;
DROP TABLE IF EXISTS company_channels;
DROP TABLE IF EXISTS company_work;
DROP TABLE IF EXISTS company_knowledge;
DROP TABLE IF EXISTS company_teams;
DROP TABLE IF EXISTS company_members;
DROP TABLE IF EXISTS commerce_usage;
DROP TABLE IF EXISTS commerce_project_access;
DROP TABLE IF EXISTS commerce_grants;
DROP TABLE IF EXISTS commerce_organizations;
DROP TABLE IF EXISTS commerce_policies;
DROP TABLE IF EXISTS commerce_products;

ALTER TABLE business_orders DROP CONSTRAINT IF EXISTS business_orders_product_check;
ALTER TABLE business_orders DROP CONSTRAINT IF EXISTS business_orders_refund_check;
ALTER TABLE business_orders ALTER COLUMN student_id SET NOT NULL;
ALTER TABLE business_orders ALTER COLUMN offer_id SET NOT NULL;
ALTER TABLE business_orders ALTER COLUMN template_version_id SET NOT NULL;
ALTER TABLE business_orders ALTER COLUMN offer_snapshot SET NOT NULL;
ALTER TABLE business_orders DROP COLUMN IF EXISTS subscription;
ALTER TABLE business_orders DROP COLUMN IF EXISTS service_starts_at;
ALTER TABLE business_orders DROP COLUMN IF EXISTS refund_amount_fen;
COMMIT;
