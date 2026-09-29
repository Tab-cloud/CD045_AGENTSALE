export const knowledgeMigration=`
CREATE TABLE IF NOT EXISTS knowledge_libraries (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id),
 name text NOT NULL, description text NOT NULL, archived boolean NOT NULL DEFAULT false, created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id),
 library_id uuid NOT NULL REFERENCES knowledge_libraries(id), name text NOT NULL, version integer NOT NULL,
 hash text NOT NULL, text text NOT NULL, chunk_count integer NOT NULL, archived boolean NOT NULL DEFAULT false,
 created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(library_id,name)
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, user_id uuid NOT NULL REFERENCES app_users(id),
 library_id uuid NOT NULL REFERENCES knowledge_libraries(id), document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, text text NOT NULL, terms text[] NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_terms ON knowledge_chunks USING gin(terms);
CREATE INDEX IF NOT EXISTS knowledge_documents_owner ON knowledge_documents(user_id,library_id);
${['knowledge_libraries','knowledge_documents','knowledge_chunks'].map(table=>`
GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO agentsale_local;
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='${table}' AND policyname='workspace_scope') THEN
 CREATE POLICY workspace_scope ON ${table} USING(workspace_id=current_setting('agentsale.workspace',true)) WITH CHECK(workspace_id=current_setting('agentsale.workspace',true));
END IF; END $$;`).join('\n')}
`;
