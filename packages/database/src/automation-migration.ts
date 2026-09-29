export const automationMigration = `
CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, username text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','operator')), enabled boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until text NOT NULL DEFAULT '', UNIQUE(workspace_id,username)
);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS wechat_app_id text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS wechat_openid text;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_unique ON app_users(workspace_id,phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_wechat_unique ON app_users(workspace_id,wechat_app_id,wechat_openid) WHERE wechat_openid IS NOT NULL;
CREATE TABLE IF NOT EXISTS app_sessions (
 id text PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id), expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_challenges (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, phone text NOT NULL, purpose text NOT NULL,
 code_hash text NOT NULL, requester_hash text NOT NULL, expires_at text NOT NULL,
 sent_at text NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS phone_challenges_lookup ON phone_challenges(workspace_id,phone,purpose,sent_at DESC);
CREATE TABLE IF NOT EXISTS wechat_oauth_states (
 id_hash text PRIMARY KEY, workspace_id text NOT NULL, user_id uuid REFERENCES app_users(id),
 purpose text NOT NULL, expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS wechat_login_pending (
 id_hash text PRIMARY KEY, workspace_id text NOT NULL, app_id text NOT NULL, openid text NOT NULL,
 verified_phone text, expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS desktop_login_requests (
 id_hash text PRIMARY KEY, workspace_id text NOT NULL, secret_hash text NOT NULL,
 display_code_hash text NOT NULL, requester_hash text NOT NULL, user_id uuid REFERENCES app_users(id),
 attempts integer NOT NULL DEFAULT 0, consumed boolean NOT NULL DEFAULT false,
 expires_at text NOT NULL, created_at text NOT NULL
);
ALTER TABLE desktop_login_requests ADD COLUMN IF NOT EXISTS consumed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS desktop_login_requests_rate ON desktop_login_requests(workspace_id,requester_hash,created_at DESC);
${['app_users','app_sessions','phone_challenges','wechat_oauth_states','wechat_login_pending','desktop_login_requests'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
