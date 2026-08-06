-- Sprint 1 hardening (v1.4.0):
--   1. Notificacion post-lead: cada tenant puede configurar un webhook saliente
--      (POST JSON) para recibir avisos de leads confirmados. Se agrega tambien
--      un secreto opcional para firmar el payload con HMAC-SHA256.
--   2. Deduplicacion de servicios en re-scan: sin un indice unico por
--      (tenant_id, name) el scanner acumulaba duplicados. Antes de crear el
--      indice se borran duplicados dejando el registro mas antiguo por nombre.

ALTER TABLE tenants ADD COLUMN notify_webhook_url TEXT;
ALTER TABLE tenants ADD COLUMN notify_webhook_secret TEXT;

-- Elimina servicios duplicados por (tenant_id, name) conservando el mas viejo.
DELETE FROM tenant_services
 WHERE id NOT IN (
   SELECT id FROM tenant_services ts2
    WHERE ts2.tenant_id = tenant_services.tenant_id
      AND ts2.name = tenant_services.name
    ORDER BY ts2.created_at ASC, ts2.id ASC
    LIMIT 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_services_tenant_name
  ON tenant_services(tenant_id, name);
