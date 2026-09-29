export const membershipMigration = `
CREATE TABLE IF NOT EXISTS membership_plans (id text NOT NULL, workspace_id text NOT NULL, document jsonb NOT NULL, PRIMARY KEY(workspace_id,id));
CREATE TABLE IF NOT EXISTS memberships (user_id uuid PRIMARY KEY REFERENCES app_users(id), workspace_id text NOT NULL, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS membership_orders (id text PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id), status text NOT NULL, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS service_usage (id uuid PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id), feature text NOT NULL, day text NOT NULL);
CREATE INDEX IF NOT EXISTS service_usage_daily ON service_usage(workspace_id,user_id,day,feature);
${['membership_plans','memberships','membership_orders','service_usage'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
