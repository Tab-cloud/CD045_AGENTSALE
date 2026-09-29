// Local bootstrap migration 001. RLS role is deliberately not the database owner.
export const migration = `
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, name text NOT NULL, sku text NOT NULL,
 supplier text NOT NULL, region text NOT NULL, market text NOT NULL, description text NOT NULL,
 source_url text NOT NULL, costs jsonb NOT NULL, version integer NOT NULL CHECK(version>0),
 sample boolean NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 UNIQUE(workspace_id,sku), UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS evidence (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, product_id uuid NOT NULL,
 title text NOT NULL, url text NOT NULL, note text NOT NULL, confirmed boolean NOT NULL, created_at text NOT NULL,
 FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS drafts (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, product_id uuid NOT NULL,
 product_version integer NOT NULL, script text NOT NULL, state text NOT NULL CHECK(state IN ('review_required','approved')),
 version integer NOT NULL CHECK(version>0), created_at text NOT NULL,
 FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, product_id uuid NOT NULL, product_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('assessment','content')), state text NOT NULL CHECK(state IN ('queued','paused','succeeded','failed')),
 version integer NOT NULL CHECK(version>0), summary text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS audit (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, action text NOT NULL, object_id text NOT NULL,
 summary text NOT NULL, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
 workspace_id text NOT NULL, key text NOT NULL, hash text NOT NULL, result jsonb NOT NULL, UNIQUE(workspace_id,key)
);
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='agentsale_local') THEN CREATE ROLE agentsale_local NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO agentsale_local;
GRANT SELECT, INSERT, UPDATE, DELETE ON products,evidence,drafts,runs,audit,idempotency TO agentsale_local;
${['products', 'evidence', 'drafts', 'runs', 'audit', 'idempotency'].map(table => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING (workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK (workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
