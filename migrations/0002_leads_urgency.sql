-- Adds an urgency flag to leads.
-- urgent=1 means the caller used an explicit urgency phrase (e.g. "lo antes
-- posible", "urgente", "hoy mismo") during the conversation. The literal phrase
-- is preserved in leads.metadata.urgencyPhrase for auditability.
ALTER TABLE leads ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_urgent_created
  ON leads(tenant_id, urgent DESC, created_at DESC);
