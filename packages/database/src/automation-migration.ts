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
CREATE TABLE IF NOT EXISTS market_signals (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, product_id uuid NOT NULL,
 platform text NOT NULL CHECK(platform IN ('tiktok_shop','temu','amazon','shopify','other')),
 country text NOT NULL, observed_at text NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('authorized_export','public_observation','manual')),
 source_ref text NOT NULL, metrics jsonb NOT NULL, created_at text NOT NULL,
 FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS market_signals_lookup ON market_signals(workspace_id,product_id,platform,country,observed_at DESC);
CREATE TABLE IF NOT EXISTS commerce_agent_state (
 workspace_id text PRIMARY KEY, document jsonb NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS commerce_agent_messages (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant','system')),
 kind text NOT NULL, content text NOT NULL, payload jsonb NOT NULL, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS commerce_agent_messages_recent ON commerce_agent_messages(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS connector_state (
 workspace_id text NOT NULL, connector text NOT NULL, document jsonb NOT NULL, updated_at text NOT NULL,
 PRIMARY KEY(workspace_id,connector)
);
CREATE TABLE IF NOT EXISTS commerce_orders (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, channel text NOT NULL, external_id text NOT NULL,
 status text NOT NULL, currency text NOT NULL, total_minor integer, document jsonb NOT NULL, updated_at text NOT NULL,
 UNIQUE(workspace_id,channel,external_id)
);
CREATE INDEX IF NOT EXISTS commerce_orders_recent ON commerce_orders(workspace_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS connector_events (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, connector text NOT NULL, external_id text NOT NULL,
 kind text NOT NULL, status text NOT NULL, payload jsonb NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 UNIQUE(workspace_id,connector,external_id)
);
${['app_users','app_sessions','automation_jobs','media_assets','automation_spend','market_signals','commerce_agent_state','commerce_agent_messages','connector_state','commerce_orders','connector_events'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
