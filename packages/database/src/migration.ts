// Web owns account, billing and model audit data only.
export const migration=`
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='agentsale_local') THEN CREATE ROLE agentsale_local NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO agentsale_local;
CREATE TABLE IF NOT EXISTS audit (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, action text NOT NULL,
 object_id text NOT NULL, summary text NOT NULL, created_at text NOT NULL
);
GRANT SELECT,INSERT,UPDATE,DELETE ON audit TO agentsale_local;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='audit' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON audit USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;
`;
