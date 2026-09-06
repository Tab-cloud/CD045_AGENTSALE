export const automationMigration = `
CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, username text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','operator')), enabled boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until text NOT NULL DEFAULT '', UNIQUE(workspace_id,username)
);
CREATE TABLE IF NOT EXISTS app_sessions (
 id text PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id), expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_jobs (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, state text NOT NULL, document jsonb NOT NULL, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, product_id uuid NOT NULL,
 document jsonb NOT NULL, FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS automation_spend (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, job_id text NOT NULL, service text NOT NULL,
 reserved_cents integer NOT NULL CHECK(reserved_cents>=0), status text NOT NULL, usage jsonb, created_at text NOT NULL
);
${['app_users','app_sessions','automation_jobs','media_assets','automation_spend'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
