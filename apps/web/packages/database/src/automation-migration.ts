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
CREATE TABLE IF NOT EXISTS agent_conversations (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, title text NOT NULL, document jsonb NOT NULL,
 created_at text NOT NULL, updated_at text NOT NULL, archived_at text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_conversations_recent ON agent_conversations(workspace_id,archived_at,updated_at DESC);
CREATE TABLE IF NOT EXISTS commerce_agent_messages (
 id uuid PRIMARY KEY, sequence bigserial NOT NULL, workspace_id text NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant','system')),
 kind text NOT NULL, content text NOT NULL, payload jsonb NOT NULL, created_at text NOT NULL
);
ALTER TABLE commerce_agent_messages ADD COLUMN IF NOT EXISTS sequence bigserial;
ALTER TABLE commerce_agent_messages ADD COLUMN IF NOT EXISTS conversation_id uuid;
GRANT USAGE, SELECT ON SEQUENCE commerce_agent_messages_sequence_seq TO agentsale_local;
CREATE INDEX IF NOT EXISTS commerce_agent_messages_conversation_recent ON commerce_agent_messages(workspace_id,conversation_id,sequence DESC);
CREATE TABLE IF NOT EXISTS agent_context_summaries (
 workspace_id text PRIMARY KEY, version integer NOT NULL, through_message_sequence bigint NOT NULL,
 document jsonb NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_memories (
 id uuid PRIMARY KEY, workspace_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('preference','constraint','fact','decision')),
 subject text NOT NULL, content text NOT NULL, confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 source_message_ids jsonb NOT NULL, valid_from text NOT NULL, valid_to text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_memories_active ON agent_memories(workspace_id,kind,valid_to,valid_from DESC);
CREATE TABLE IF NOT EXISTS agent_context_runs (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, message_id uuid NOT NULL,
 summary_version integer NOT NULL, recent_message_ids jsonb NOT NULL, memory_ids jsonb NOT NULL,
 estimated_tokens integer NOT NULL, status text NOT NULL CHECK(status IN ('prepared','completed','failed')),
 maintenance_error text NOT NULL DEFAULT '', usage jsonb NOT NULL, created_at text NOT NULL, completed_at text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_context_runs_recent ON agent_context_runs(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_conversation_context_summaries (
 workspace_id text NOT NULL, conversation_id uuid NOT NULL, version integer NOT NULL, through_message_sequence bigint NOT NULL,
 document jsonb NOT NULL, updated_at text NOT NULL, PRIMARY KEY(workspace_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS agent_conversation_memories (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, conversation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('preference','constraint','fact','decision')),
 subject text NOT NULL, content text NOT NULL, confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 source_message_ids jsonb NOT NULL, valid_from text NOT NULL, valid_to text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_conversation_memories_active ON agent_conversation_memories(workspace_id,conversation_id,kind,valid_to,valid_from DESC);
CREATE TABLE IF NOT EXISTS agent_conversation_context_runs (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, conversation_id uuid NOT NULL, message_id uuid NOT NULL,
 summary_version integer NOT NULL, recent_message_ids jsonb NOT NULL, memory_ids jsonb NOT NULL,
 estimated_tokens integer NOT NULL, status text NOT NULL CHECK(status IN ('prepared','completed','failed')),
 maintenance_error text NOT NULL DEFAULT '', usage jsonb NOT NULL, created_at text NOT NULL, completed_at text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_conversation_context_runs_recent ON agent_conversation_context_runs(workspace_id,conversation_id,created_at DESC);
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
CREATE TABLE IF NOT EXISTS connector_oauth_states (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, connector text NOT NULL, state_hash text NOT NULL,
 expires_at text NOT NULL, consumed_at text NOT NULL DEFAULT '', created_at text NOT NULL,
 UNIQUE(workspace_id,state_hash)
);
CREATE TABLE IF NOT EXISTS commerce_records (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, connector text NOT NULL, record_type text NOT NULL,
 external_id text NOT NULL, document jsonb NOT NULL, observed_at text NOT NULL,
 UNIQUE(workspace_id,connector,record_type,external_id)
);
CREATE INDEX IF NOT EXISTS commerce_records_recent ON commerce_records(workspace_id,record_type,observed_at DESC);
${['app_users','app_sessions','automation_jobs','media_assets','automation_spend','market_signals','commerce_agent_state','agent_conversations','commerce_agent_messages','agent_context_summaries','agent_memories','agent_context_runs','agent_conversation_context_summaries','agent_conversation_memories','agent_conversation_context_runs','connector_state','commerce_orders','connector_events','connector_oauth_states','commerce_records'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
