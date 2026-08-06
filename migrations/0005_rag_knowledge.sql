-- 0005: RAG sobre knowledge_sources
--
-- Fase 1 (D1 FTS5):
--   - Virtual table FTS5 sobre title+summary de knowledge_sources.
--   - Triggers para mantener el \u00edndice sincronizado en INSERT/UPDATE/DELETE.
--   - Consulta principal: MATCH con tenant_id filtrado en JOIN.
--
-- Fase 2 (Vectorize) — no toca D1:
--   - Cada knowledge_sources.id se indexa como vector en el \u00edndice
--     'agentica-knowledge' con metadata { tenant_id, source_id, url }.
--   - El worker embbebe la pregunta del usuario en runtime y consulta
--     Vectorize con filter { tenant_id: X }. Si Vectorize responde, se
--     usa el top result. Si no, cae a FTS5.
--
-- menu_topics:
--   - JSON array de 3-4 topics agrupados (ej. ["Servicios",
--     "Promociones", "Instalaciones"]) que el bot ofrece despu\u00e9s del
--     nombre. Se genera en createSmartFlowFromKnowledge desde
--     tenant_services + knowledge_sources.title patterns.
--
-- vectorized_at en knowledge_sources: marca si ya se subi\u00f3 el vector
-- para esa fila. NULL = pendiente. Timestamp = vectorizado. Sirve para
-- rebuildear s\u00f3lo lo que cambi\u00f3.

ALTER TABLE agent_flows ADD COLUMN menu_topics TEXT NOT NULL DEFAULT '[]';

ALTER TABLE knowledge_sources ADD COLUMN vectorized_at INTEGER;

-- FTS5 virtual table. content='knowledge_sources' hace que FTS5 no
-- duplique el texto: guarda s\u00f3lo el \u00edndice y consulta la tabla base
-- por rowid. rowid en knowledge_sources es interno (rowid autom\u00e1tico
-- de SQLite), pero como id es TEXT PRIMARY KEY, necesitamos un rowid
-- estable: usamos content_rowid='rowid' impl\u00edcito.
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_sources_fts USING fts5(
  title,
  summary,
  tenant_id UNINDEXED,
  content='knowledge_sources',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers para mantener FTS5 en sync. Idempotentes con IF NOT EXISTS.
CREATE TRIGGER IF NOT EXISTS knowledge_sources_ai AFTER INSERT ON knowledge_sources BEGIN
  INSERT INTO knowledge_sources_fts(rowid, title, summary, tenant_id)
  VALUES (new.rowid, new.title, new.summary, new.tenant_id);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_sources_ad AFTER DELETE ON knowledge_sources BEGIN
  INSERT INTO knowledge_sources_fts(knowledge_sources_fts, rowid, title, summary, tenant_id)
  VALUES('delete', old.rowid, old.title, old.summary, old.tenant_id);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_sources_au AFTER UPDATE ON knowledge_sources BEGIN
  INSERT INTO knowledge_sources_fts(knowledge_sources_fts, rowid, title, summary, tenant_id)
  VALUES('delete', old.rowid, old.title, old.summary, old.tenant_id);
  INSERT INTO knowledge_sources_fts(rowid, title, summary, tenant_id)
  VALUES (new.rowid, new.title, new.summary, new.tenant_id);
END;

-- Rebuild inicial: indexa todo lo escaneado hasta ahora. Idempotente:
-- 'rebuild' recrea el \u00edndice completo desde content='knowledge_sources'.
INSERT INTO knowledge_sources_fts(knowledge_sources_fts) VALUES('rebuild');
