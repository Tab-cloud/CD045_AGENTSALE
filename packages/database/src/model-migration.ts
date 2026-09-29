export const modelMigration=`
CREATE TABLE IF NOT EXISTS model_requests (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users(id),
  capability text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_requests_user ON model_requests(workspace_id,user_id,created_at);
-- Search and local knowledge are desktop capabilities. Existing paid plan snapshots
-- retain their price and model/media grants while their obsolete search quota is removed.
UPDATE membership_plans SET document=document #- '{limits,search}' WHERE document->'limits' ? 'search';
UPDATE memberships SET document=document #- '{plan,limits,search}' WHERE document->'plan'->'limits' ? 'search';
UPDATE membership_orders SET document=document #- '{plan,limits,search}' WHERE document->'plan'->'limits' ? 'search';
${['model_requests'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING (workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK (workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;
`).join('')}
`;
