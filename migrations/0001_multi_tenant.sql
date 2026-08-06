CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  vertical TEXT NOT NULL,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  solution_type TEXT NOT NULL DEFAULT 'conversational_agent',
  website TEXT,
  brand_voice_profile TEXT NOT NULL DEFAULT '{}',
  behavior_profile TEXT NOT NULL DEFAULT '{}',
  handoff_rules TEXT NOT NULL DEFAULT '{}',
  memory_policy TEXT NOT NULL DEFAULT '{}',
  learning_policy TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tenant_channels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'twilio',
  status TEXT NOT NULL DEFAULT 'active',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(channel, address)
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_type TEXT NOT NULL DEFAULT 'url',
  url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(tenant_id, url)
);

CREATE TABLE IF NOT EXISTS knowledge_profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  business_summary TEXT NOT NULL,
  value_proposition TEXT NOT NULL,
  primary_cta TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tenant_services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  source_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS agent_flows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  greeting TEXT NOT NULL,
  confirmation_template TEXT NOT NULL,
  completion_message TEXT NOT NULL,
  fallback_message TEXT NOT NULL,
  speech_hints TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS flow_steps (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES agent_flows(id),
  step_order INTEGER NOT NULL,
  slot_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  validation TEXT NOT NULL DEFAULT '{}',
  retry_prompt TEXT,
  UNIQUE(flow_id, step_order)
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,
  service TEXT,
  requested_at TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'voice',
  metadata TEXT NOT NULL DEFAULT '{}',
  urgent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(tenant_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_urgent_created ON leads(tenant_id, urgent DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_email TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
