-- Consolida agent_flows: por (tenant_id, channel), mantener el flow activo y
-- el draft con updated_at m\u00e1s reciente. Todo lo dem\u00e1s se elimina, junto con
-- sus flow_steps.
--
-- Motivaci\u00f3n: POST /flow hac\u00eda INSERT por cada guardado, acumulando docenas
-- de drafts hu\u00e9rfanos. Publish activaba el m\u00e1s reciente por updated_at,
-- err\u00e1tico cuando varias filas compart\u00edan segundo.
--
-- Idempotente: sin drafts hu\u00e9rfanos, no borra nada.
--
-- Nota: D1 no permite CREATE TEMP TABLE (SQLITE_AUTH), as\u00ed que usamos
-- subqueries directas.

DELETE FROM flow_steps
 WHERE flow_id IN (
   SELECT id FROM agent_flows af
    WHERE af.status = 'draft'
      AND af.id NOT IN (
        SELECT id FROM agent_flows af2
         WHERE af2.tenant_id = af.tenant_id
           AND af2.channel = af.channel
           AND af2.status = 'draft'
         ORDER BY af2.updated_at DESC, af2.id DESC
         LIMIT 1
      )
 );

DELETE FROM agent_flows
 WHERE status = 'draft'
   AND id NOT IN (
     SELECT id FROM agent_flows af2
      WHERE af2.tenant_id = agent_flows.tenant_id
        AND af2.channel = agent_flows.channel
        AND af2.status = 'draft'
      ORDER BY af2.updated_at DESC, af2.id DESC
      LIMIT 1
   );

-- \u00cdndices parciales que garantizan a nivel D1: m\u00e1x 1 activo + 1 draft por
-- (tenant_id, channel). Cualquier c\u00f3digo que intente violar esto falla.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_flows_one_active
  ON agent_flows(tenant_id, channel)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_flows_one_draft
  ON agent_flows(tenant_id, channel)
  WHERE status = 'draft';
