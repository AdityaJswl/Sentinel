-- Idempotent hardening, applied by db:migrate after Prisma migrations.
-- The server connects as the table owner; browser access goes through Express.
DO $$
DECLARE schema_name text := current_schema(); table_name text; role_name text;
BEGIN
  IF schema_name <> 'sentinel' AND schema_name !~ '^sentinel_test_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Refusing to change permissions outside Sentinel schema';
  END IF;
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', schema_name);
  FOREACH table_name IN ARRAY ARRAY['agents','delegations','budgets_usage','decisions','approvals','denials','nonces','authorization_artifacts','transactions','webhook_receipts','audit_events','_prisma_migrations'] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', schema_name, table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC', schema_name, table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', schema_name, role_name);
        EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %I', schema_name, table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
  EXECUTE format('ALTER FUNCTION %I.prevent_audit_mutation() SET search_path = pg_catalog', schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.prevent_audit_mutation() FROM PUBLIC', schema_name);
END $$;
