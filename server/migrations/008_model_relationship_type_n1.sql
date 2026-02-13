-- ============================================
-- Allow n-1 cardinality in saved model relationships
-- ============================================

DO $$
DECLARE
    rel_constraint RECORD;
BEGIN
    IF to_regclass('public.model_relationships') IS NULL THEN
        RETURN;
    END IF;

    FOR rel_constraint IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.check_constraints cc
          ON cc.constraint_name = tc.constraint_name
         AND cc.constraint_schema = tc.constraint_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'model_relationships'
          AND tc.constraint_type = 'CHECK'
          AND cc.check_clause ILIKE '%relationship_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.model_relationships DROP CONSTRAINT IF EXISTS %I', rel_constraint.constraint_name);
    END LOOP;

    ALTER TABLE public.model_relationships
        ADD CONSTRAINT model_relationships_relationship_type_check
        CHECK (relationship_type IN ('1-1', '1-n', 'n-1', 'n-n'));
END $$;
