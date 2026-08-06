import { flowTemplates, getTemplateById, getTemplatesForVertical, type FlowTemplate } from "./flow-templates";
import { indexKnowledgeSource } from "./ai/rag";

interface AdminIdentity {
  email: string;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  country: string;
  timezone: string;
  language: string;
  status: string;
  solution_type: string;
  website: string | null;
  voice_number: string | null;
}

interface CreateTenantInput {
  name?: string;
  assistantName?: string;
  voiceNumber?: string;
  vertical?: string;
  website?: string;
  country?: string;
  timezone?: string;
  language?: string;
}

interface UpdateTenantInput {
  name?: string;
  voiceNumber?: string;
  vertical?: string;
  website?: string;
  country?: string;
  timezone?: string;
  language?: string;
  notifyWebhookUrl?: string | null;
  notifyWebhookSecret?: string | null;
}

interface SaveFlowInput {
  templateId?: string;
  assistantName?: string;
  customFlow?: Partial<FlowTemplate> & { assistantName?: string };
}

interface KnowledgeSourceRow {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
}

const allowedAdminEmail = "jose301184@gmail.com";

export function getAdminIdentity(request: Request): AdminIdentity | undefined {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return undefined;
  }
  return { email };
}

export function requireAdmin(request: Request): AdminIdentity | Response {
  const identity = getAdminIdentity(request);
  if (identity?.email.toLowerCase() === allowedAdminEmail) {
    return identity;
  }

  if (identity) {
    return Response.json(
      {
        error: "Forbidden",
        message: `El admin solo permite acceso a ${allowedAdminEmail}.`,
      },
      { status: 403 },
    );
  }

  return Response.json(
    {
      error: "Cloudflare Access required",
      message: `admin.angaflow.mx debe estar protegido por Cloudflare Access. Policy requerida: permitir solo ${allowedAdminEmail}. No se recibió Cf-Access-Authenticated-User-Email.`,
    },
    { status: 401 },
  );
}

export async function handleAdminApi(request: Request, env: Env, identity: AdminIdentity, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "");

  if (request.method === "GET" && path === "me") {
    return json({ email: identity.email });
  }

  if (request.method === "GET" && path === "tenants") {
    // ?include=deleted expone tenants soft-deleted para el panel de
    // recuperaci\u00f3n. Por defecto s\u00f3lo mostramos los que NO est\u00e1n
    // borrados l\u00f3gicamente.
    const includeDeleted = url.searchParams.get("include") === "deleted";
    const whereClause = includeDeleted ? "" : "WHERE t.status != 'deleted'";
    const tenants = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.vertical, t.country, t.timezone, t.language, t.status, t.solution_type, t.website,
              t.deleted_at,
              tc.address AS voice_number
         FROM tenants t
         LEFT JOIN tenant_channels tc ON tc.tenant_id = t.id AND tc.channel = 'voice' AND tc.status = 'active'
         ${whereClause}
        ORDER BY t.created_at DESC`,
    ).all<TenantRow>();
    return json({ tenants: tenants.results ?? [] });
  }

  if (request.method === "GET" && path === "flow-templates") {
    return json({ templates: flowTemplates });
  }

  if (request.method === "POST" && path === "tenants") {
    const input = (await request.json().catch(() => ({}))) as CreateTenantInput;
    if (!input.name?.trim()) {
      return json({ error: "Business name required" }, 400);
    }
    if (!input.website || !isHttpUrl(input.website)) {
      return json({ error: "Valid business URL required" }, 400);
    }

    const tenantId = `tenant_${crypto.randomUUID()}`;
    // Slug base con desambiguaci\u00f3n. Aunque el soft-delete libera
    // slugs, dos tenants activos podr\u00edan compartir nombre; a\u00f1adimos
    // suffix num\u00e9rico si detectamos colisi\u00f3n.
    let slug = slugify(input.name);
    const collision = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM tenants WHERE slug = ?",
    ).bind(slug).first<{ c: number }>();
    if ((collision?.c ?? 0) > 0) {
      slug = `${slug}-${tenantId.slice(-6)}`;
    }
    const vertical = input.vertical?.trim() || "General / Conversacional";
    const timezone = input.timezone?.trim() || "America/Mexico_City";
    const language = input.language?.trim() || "es-MX";
    const country = input.country?.trim() || "MX";

    try {
      await env.DB.prepare(
        `INSERT INTO tenants (
           id, name, slug, vertical, country, timezone, language, website,
           brand_voice_profile, behavior_profile, handoff_rules, memory_policy, learning_policy
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          tenantId,
          input.name.trim(),
          slug,
          vertical,
          country,
          timezone,
          language,
          input.website,
          JSON.stringify({ tone: "profesional, natural y útil", brand_phrases: [], avoid: ["sonar robotizado"] }),
          JSON.stringify({ target_response_seconds: 2, naturalness: "high", fallback_retries: 2, solution_type: "conversational_agent" }),
          JSON.stringify({ transfer_when: ["solicitud explícita de humano", "baja confianza", "frustración", "más de dos reintentos"], default_message: "Te canalizo con una persona del equipo." }),
          JSON.stringify({ enabled: true, remember: ["servicio consultado", "preferencia de canal", "historial de conversaciones"], do_not_store: ["secretos", "credenciales", "datos bancarios"] }),
          JSON.stringify({ mode: "human_approved", version_before_publish: true }),
        )
        .run();
    } catch (error) {
      console.error({
        message: "tenant.create failed",
        error: error instanceof Error ? error.message : String(error),
        input: { name: input.name, slug, website: input.website },
      });
      const msg = error instanceof Error ? error.message : String(error);
      if (/UNIQUE.*slug/i.test(msg)) {
        return json({
          error: "Slug already in use",
          message: "Ya existe un negocio con ese nombre. Usa uno distinto o restaura el negocio borrado.",
        }, 409);
      }
      return json({ error: "Could not create business", detail: msg }, 500);
    }

    await env.DB.prepare(
      `INSERT INTO knowledge_sources (id, tenant_id, url, title, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
      .bind(`source_${crypto.randomUUID()}`, tenantId, input.website, "Sitio principal")
      .run();

    await createDefaultFlow(env, tenantId, input.name.trim(), language, timezone, input.assistantName?.trim() || "Asistente virtual");
    await upsertVoiceChannel(env, tenantId, input.voiceNumber?.trim());
    await audit(env, tenantId, identity.email, "tenant.create", { name: input.name, vertical, website: input.website });

    // Auto-scan del sitio principal en background. No bloqueamos la
    // respuesta HTTP porque el scan puede tardar 30-60s (fetch p\u00e1ginas
    // + embeddings + Vectorize). El admin UI hace polling de /sources
    // y muestra el progreso. Si ctx no est\u00e1 disponible por alg\u00fan motivo,
    // caemos a await bloqueante como fallback.
    const scanTask = (async () => {
      try {
        const result = await scanKnowledgeSources(env, tenantId);
        await audit(env, tenantId, identity.email, "knowledge_sources.auto_scan", result);
        console.log({
          message: "tenant.create: auto-scan complete",
          tenantId,
          result,
        });
      } catch (error) {
        console.error({
          message: "tenant.create: auto-scan failed",
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    if (ctx) {
      ctx.waitUntil(scanTask);
    } else {
      await scanTask;
    }

    return json({ ok: true, tenantId, autoScan: true });
  }

  const tenantMatch = path.match(/^tenants\/([^/]+)(?:\/(services|sources|flow|leads|scan|publish|restore|purge))?$/);
  if (!tenantMatch) {
    return json({ error: "Not found" }, 404);
  }

  const tenantId = tenantMatch[1];
  const action = tenantMatch[2];

  if (request.method === "GET" && !action) {
    const tenant = await env.DB.prepare(
      `SELECT id, name, slug, vertical, country, timezone, language, status, solution_type, website,
              brand_voice_profile, behavior_profile, handoff_rules, memory_policy, learning_policy,
              notify_webhook_url, notify_webhook_secret
         FROM tenants
        WHERE id = ?`,
    )
      .bind(tenantId)
      .first();
    return tenant ? json({ tenant }) : json({ error: "Tenant not found" }, 404);
  }

  if (request.method === "PATCH" && !action) {
    const input = (await request.json().catch(() => ({}))) as UpdateTenantInput;
    const existing = await env.DB.prepare("SELECT id, name, website FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ id: string; name: string; website: string | null }>();
    if (!existing) {
      return json({ error: "Tenant not found" }, 404);
    }

    const name = input.name?.trim() || existing.name;
    const website = input.website?.trim() || existing.website;
    if (website && !isHttpUrl(website)) {
      return json({ error: "Valid business URL required" }, 400);
    }

    // Notify webhook: null-string explicito borra la config; undefined la
    // preserva; string no vacio valida y actualiza.
    const notifyUrlInput = input.notifyWebhookUrl;
    let notifyUrl: string | null | undefined;
    if (notifyUrlInput === undefined) {
      notifyUrl = undefined;
    } else if (notifyUrlInput === null || notifyUrlInput.trim() === "") {
      notifyUrl = null;
    } else {
      const trimmed = notifyUrlInput.trim();
      if (!isHttpUrl(trimmed)) {
        return json({ error: "notifyWebhookUrl must be http/https" }, 400);
      }
      notifyUrl = trimmed;
    }

    const notifySecretInput = input.notifyWebhookSecret;
    let notifySecret: string | null | undefined;
    if (notifySecretInput === undefined) {
      notifySecret = undefined;
    } else if (notifySecretInput === null || notifySecretInput.trim() === "") {
      notifySecret = null;
    } else {
      notifySecret = notifySecretInput.trim();
    }

    await env.DB.prepare(
      `UPDATE tenants
          SET name = ?, slug = ?, vertical = COALESCE(?, vertical), website = ?, country = COALESCE(?, country), timezone = COALESCE(?, timezone), language = COALESCE(?, language),
              notify_webhook_url = CASE WHEN ? = 1 THEN notify_webhook_url ELSE ? END,
              notify_webhook_secret = CASE WHEN ? = 1 THEN notify_webhook_secret ELSE ? END,
              updated_at = strftime('%s','now')
        WHERE id = ?`,
    )
      .bind(
        name,
        slugify(name),
        input.vertical?.trim() || null,
        website,
        input.country?.trim() || null,
        input.timezone?.trim() || null,
        input.language?.trim() || null,
        notifyUrl === undefined ? 1 : 0,
        notifyUrl ?? null,
        notifySecret === undefined ? 1 : 0,
        notifySecret ?? null,
        tenantId,
      )
      .run();

    await upsertVoiceChannel(env, tenantId, input.voiceNumber?.trim());

    await audit(env, tenantId, identity.email, "tenant.update", {
      name,
      vertical: input.vertical,
      website,
      voiceNumber: input.voiceNumber,
      notifyWebhookUrlChanged: notifyUrl !== undefined,
      notifyWebhookSecretChanged: notifySecret !== undefined,
    });
    return json({ ok: true });
  }

  // Soft delete: marca tenant como deleted, desactiva channels (libera
  // el n\u00famero para reasignaci\u00f3n), preserva flows, leads, knowledge y
  // audit. Recuperable con POST /tenants/{id}/restore.
  //
  // Requiere confirmaci\u00f3n escrita en body { "confirm": "<nombre exacto>" }
  // para evitar borrados accidentales v\u00eda API.
  if (request.method === "DELETE" && !action) {
    const existing = await env.DB.prepare("SELECT id, name, status FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ id: string; name: string; status: string }>();
    if (!existing) {
      return json({ error: "Tenant not found" }, 404);
    }
    if (existing.status === "deleted") {
      return json({ error: "Tenant already deleted" }, 409);
    }

    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (!body.confirm || body.confirm.trim() !== existing.name) {
      return json({
        error: "Confirmation required",
        message: `Env\u00eda { \"confirm\": \"${existing.name}\" } para confirmar el borrado.`,
      }, 400);
    }

    // No tocamos agent_flows.status: los unique parciales
    // idx_agent_flows_one_active / _one_draft causar\u00edan conflicto si
    // demoteamos active\u2192draft con un draft preexistente. El filtro por
    // tenants.status='active' en resolveRuntimeConfig ya impide que un
    // tenant deleted responda llamadas. En restore devuelve al estado
    // exacto sin ambig\u00fcedad.
    // Liberamos slug para permitir crear un tenant nuevo con el mismo
    // nombre. Guardamos el slug original en un suffix con el tenantId
    // para poder restaurarlo sin colisi\u00f3n si el nombre sigue libre.
    // Formato: "__deleted__<timestamp>__<slug_original>"
    const parkedSlug = `__deleted__${Date.now()}__${tenantId.slice(-8)}`;

    await audit(env, tenantId, identity.email, "tenant.soft_delete", { name: existing.name });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE tenants SET status = 'deleted', deleted_at = strftime('%s','now'), updated_at = strftime('%s','now'), slug = ? WHERE id = ?",
      ).bind(parkedSlug, tenantId),
      env.DB.prepare(
        "UPDATE tenant_channels SET status = 'deleted' WHERE tenant_id = ?",
      ).bind(tenantId),
    ]);
    return json({ ok: true, softDeletedTenantId: tenantId, restorable: true });
  }

  // Restore: devuelve el tenant a status='active' y reactiva su channel.
  // Requiere que el n\u00famero no est\u00e9 tomado por otro tenant activo.
  if (request.method === "POST" && action === "restore") {
    const existing = await env.DB.prepare("SELECT id, name, status FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ id: string; name: string; status: string }>();
    if (!existing) {
      return json({ error: "Tenant not found" }, 404);
    }
    if (existing.status !== "deleted") {
      return json({ error: "Tenant is not deleted" }, 409);
    }

    // Verificar que el n\u00famero del tenant no est\u00e9 tomado por otro activo.
    const conflictingChannel = await env.DB.prepare(
      `SELECT tc.address, t.name AS holder_name
         FROM tenant_channels tc
         JOIN tenants t ON t.id = tc.tenant_id
        WHERE tc.tenant_id = ?
          AND tc.channel = 'voice'
          AND EXISTS (
            SELECT 1 FROM tenant_channels tc2
             JOIN tenants t2 ON t2.id = tc2.tenant_id
            WHERE tc2.channel = 'voice'
              AND tc2.address = tc.address
              AND tc2.status = 'active'
              AND t2.status = 'active'
              AND tc2.tenant_id != tc.tenant_id
          )
        LIMIT 1`,
    ).bind(tenantId).first<{ address: string; holder_name: string }>();
    if (conflictingChannel) {
      return json({
        error: "Channel conflict",
        message: `El n\u00famero ${conflictingChannel.address} lo tiene ${conflictingChannel.holder_name}. Cambia el n\u00famero de aquel primero.`,
      }, 409);
    }

    await audit(env, tenantId, identity.email, "tenant.restore", { name: existing.name });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE tenants SET status = 'active', deleted_at = NULL, updated_at = strftime('%s','now') WHERE id = ?",
      ).bind(tenantId),
      env.DB.prepare(
        "UPDATE tenant_channels SET status = 'active' WHERE tenant_id = ? AND status = 'deleted'",
      ).bind(tenantId),
    ]);
    return json({ ok: true, restoredTenantId: tenantId });
  }

  // Hard delete (purge): borrado permanente de D1 + Vectorize.
  // S\u00f3lo permitido si el tenant est\u00e1 previamente soft-deleted.
  // Requiere confirmaci\u00f3n escrita del nombre exacto.
  if (request.method === "DELETE" && action === "purge") {
    const existing = await env.DB.prepare("SELECT id, name, status FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ id: string; name: string; status: string }>();
    if (!existing) {
      return json({ error: "Tenant not found" }, 404);
    }
    if (existing.status !== "deleted") {
      return json({
        error: "Must soft-delete first",
        message: "Borra el negocio (soft delete) antes de purgarlo permanentemente.",
      }, 409);
    }

    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (!body.confirm || body.confirm.trim() !== existing.name) {
      return json({
        error: "Confirmation required",
        message: `Env\u00eda { \"confirm\": \"${existing.name}\" } para purgar permanentemente.`,
      }, 400);
    }

    // 1. Limpieza de Vectorize antes de borrar knowledge_sources.
    // Recolectamos IDs para deleteByIds. Si Vectorize falla, seguimos
    // (los vectores quedar\u00e1n hu\u00e9rfanos pero el D1 borra bien).
    let vectorsDeleted = 0;
    try {
      const sources = await env.DB.prepare(
        "SELECT id FROM knowledge_sources WHERE tenant_id = ?",
      ).bind(tenantId).all<{ id: string }>();
      const ids = (sources.results ?? []).map((r) => r.id);
      if (ids.length > 0 && env.VECTORIZE) {
        // Vectorize permite hasta 1000 IDs por deleteByIds; loopeamos por si acaso.
        for (let i = 0; i < ids.length; i += 1000) {
          const batch = ids.slice(i, i + 1000);
          await env.VECTORIZE.deleteByIds(batch);
          vectorsDeleted += batch.length;
        }
      }
    } catch (error) {
      console.error({
        message: "tenant.purge: vectorize cleanup failed",
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await audit(env, tenantId, identity.email, "tenant.purge", {
      name: existing.name,
      vectorsDeleted,
    });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM flow_steps WHERE flow_id IN (SELECT id FROM agent_flows WHERE tenant_id = ?)").bind(tenantId),
      env.DB.prepare("DELETE FROM agent_flows WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM leads WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM tenant_services WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM knowledge_profiles WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM knowledge_sources WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM tenant_channels WHERE tenant_id = ?").bind(tenantId),
      env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId),
    ]);
    return json({ ok: true, purgedTenantId: tenantId, vectorsDeleted });
  }

  if (request.method === "GET" && action === "services") {
    const services = await env.DB.prepare(
      `SELECT id, name, description, keywords, priority, source_url
         FROM tenant_services
        WHERE tenant_id = ?
        ORDER BY priority ASC, name ASC`,
    )
      .bind(tenantId)
      .all();
    return json({ services: services.results ?? [] });
  }

  if (request.method === "GET" && action === "sources") {
    const sources = await env.DB.prepare(
      `SELECT id, source_type, url, title, status, summary, updated_at
         FROM knowledge_sources
        WHERE tenant_id = ?
        ORDER BY created_at ASC`,
    )
      .bind(tenantId)
      .all();
    return json({ sources: sources.results ?? [] });
  }

  if (request.method === "POST" && action === "sources") {
    const input = (await request.json().catch(() => ({}))) as { url?: string; title?: string };
    if (!input.url || !isHttpUrl(input.url)) {
      return json({ error: "Valid URL required" }, 400);
    }

    const id = `source_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO knowledge_sources (id, tenant_id, url, title, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON CONFLICT(tenant_id, url) DO UPDATE SET title = excluded.title, status = 'pending', updated_at = strftime('%s','now')`,
    )
      .bind(id, tenantId, input.url, input.title ?? input.url)
      .run();
    await audit(env, tenantId, identity.email, "knowledge_source.upsert", { url: input.url });
    return json({ ok: true });
  }

  if (request.method === "POST" && action === "scan") {
    const result = await scanKnowledgeSources(env, tenantId);
    await audit(env, tenantId, identity.email, "knowledge_sources.scan", result);
    return json(result);
  }

  if (request.method === "GET" && action === "flow") {
    // Prefiere el draft (lo que se est\u00e1 editando). Si no hay draft, cae al
    // active para que el editor tenga algo con qu\u00e9 empezar. Nunca devuelve
    // archived. Invariante: 1 draft + 1 active m\u00e1x por (tenant, channel).
    const flow = await env.DB.prepare(
      `SELECT id, channel, version, status, greeting, confirmation_template, completion_message, fallback_message, speech_hints, settings, updated_at
         FROM agent_flows
        WHERE tenant_id = ? AND channel = 'voice' AND status IN ('draft', 'active')
         ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END
        LIMIT 1`,
    )
      .bind(tenantId)
      .first();
    const steps = flow
      ? await env.DB.prepare(
          `SELECT step_order, slot_key, prompt, required, retry_prompt
             FROM flow_steps
            WHERE flow_id = ?
            ORDER BY step_order ASC`,
        )
          .bind(String(flow.id))
          .all()
      : { results: [] };
    return json({ flow, steps: steps.results ?? [] });
  }

  if (request.method === "POST" && action === "flow") {
    const input = (await request.json().catch(() => ({}))) as SaveFlowInput;
    const tenant = await env.DB.prepare("SELECT name, vertical, language, timezone FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ name: string; vertical: string; language: string; timezone: string }>();
    if (!tenant) {
      return json({ error: "Tenant not found" }, 404);
    }

    const flow = buildFlowDraft(input, tenant.name, tenant.vertical);
    if ("error" in flow) {
      return json({ error: flow.error }, 400);
    }

    const assistantName = input.assistantName?.trim() || input.customFlow?.assistantName?.trim() || "Asistente virtual";
    const flowId = await createFlowDraft(env, tenantId, flow, tenant.name, tenant.language, tenant.timezone, assistantName);
    await audit(env, tenantId, identity.email, "flow.draft.create", { flowId, templateId: input.templateId ?? null, custom: Boolean(input.customFlow) });
    return json({ ok: true, flowId, templateId: input.templateId ?? null });
  }

  if (request.method === "POST" && action === "publish") {
    // El draft es \u00fanico por (tenant_id, channel='voice') gracias al \u00edndice
    // parcial. Publish lo promueve a active de forma at\u00f3mica y baja el activo
    // anterior a draft si exist\u00eda. No dependemos de updated_at.
    const draft = await env.DB.prepare(
      `SELECT id, version, greeting, settings
         FROM agent_flows
        WHERE tenant_id = ? AND channel = 'voice' AND status = 'draft'
        LIMIT 1`,
    )
      .bind(tenantId)
      .first<{ id: string; version: string; greeting: string; settings: string | null }>();
    if (!draft) {
      return json({ error: "No draft flow to publish. Save a draft first." }, 404);
    }

    // D1 no soporta transacciones expl\u00edcitas; batch() ejecuta las statements
    // en una sola invocaci\u00f3n at\u00f3mica. Orden importa: el active viejo baja a
    // 'archived' antes que el draft suba a 'active' para no violar el \u00edndice.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_flows
            SET status = 'archived', updated_at = strftime('%s','now')
          WHERE tenant_id = ? AND channel = 'voice' AND status = 'active' AND id != ?`,
      ).bind(tenantId, draft.id),
      env.DB.prepare(
        `UPDATE agent_flows
            SET status = 'active', updated_at = strftime('%s','now')
          WHERE id = ?`,
      ).bind(draft.id),
    ]);

    const channel = await env.DB.prepare("SELECT address FROM tenant_channels WHERE tenant_id = ? AND channel = 'voice' AND status = 'active' LIMIT 1")
      .bind(tenantId)
      .first<{ address: string }>();
    const settings = parseJsonRecord(draft.settings);
    const activeFlow = await env.DB.prepare(
      "SELECT id, version, status FROM agent_flows WHERE id = ? AND status = 'active' LIMIT 1",
    )
      .bind(draft.id)
      .first<{ id: string; version: string; status: string }>();

    if (!activeFlow) {
      return json({ error: "Publish failed: draft did not activate. Check D1 logs." }, 500);
    }

    await audit(env, tenantId, identity.email, "flow.publish", {
      flowId: draft.id,
      version: draft.version,
      voiceNumber: channel?.address ?? null,
    });
    console.log(
      JSON.stringify({
        message: "flow published",
        tenantId,
        flowId: draft.id,
        version: draft.version,
        voiceNumber: channel?.address ?? null,
      }),
    );
    return json({
      ok: true,
      flowId: draft.id,
      version: draft.version,
      activeStatus: activeFlow.status,
      assistantName: stringFrom(settings.assistant_name, "Asistente virtual"),
      voiceNumber: channel?.address ?? null,
      greetingPreview: draft.greeting,
      publishedAt: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && action === "leads") {
    const leads = await env.DB.prepare(
      `SELECT id, channel, conversation_id, name, phone, email, company, service, requested_at,
              status, source, urgent, metadata, created_at
         FROM leads
        WHERE tenant_id = ?
        ORDER BY urgent DESC, created_at DESC
        LIMIT 100`,
    )
      .bind(tenantId)
      .all();
    return json({ leads: leads.results ?? [] });
  }

  return json({ error: "Not found" }, 404);
}

async function scanKnowledgeSources(env: Env, tenantId: string): Promise<{ ok: boolean; scanned: number; discovered: number; failed: number }> {
  const maxPages = 150;
  const sources = await env.DB.prepare(
    `SELECT id, url
       FROM knowledge_sources
      WHERE tenant_id = ?
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'error' THEN 1 ELSE 2 END, created_at ASC
      LIMIT ?`,
  )
    .bind(tenantId, maxPages)
    .all<{ id: string; url: string }>();

  const queue = [...(sources.results ?? [])].map((source) => ({ ...source, url: canonicalizeUrl(source.url) }));
  const knownUrls = new Set(queue.map((source) => source.url));
  const visited = new Set<string>();
  let scanned = 0;
  let discovered = 0;
  let failed = 0;

  // Bonus multi-vertical: si el sitio expone sitemap.xml, sembramos
  // TODAS sus URLs antes de empezar el BFS. Esto garantiza cobertura
  // en sitios con navegaci\u00f3n JS o men\u00fas complejos donde los <a href>
  // no est\u00e1n en el HTML est\u00e1tico. Falla silente.
  const seed = queue[0];
  if (seed) {
    try {
      const origin = new URL(seed.url).origin;
      const sitemapUrls = await tryReadSitemap(origin);
      // Priorizamos URLs con vocabulario de alto valor semantico.
      // El scanner ver\u00e1 primero contacto/servicios/producto/habitaci\u00f3n/
      // reserva/etc. antes que blog y misc. Cubre todas las verticales.
      const HIGH_VALUE = /contacto|contact|about|nosotros|quienes|servicio|servicios|solucion|soluci[oó]n|producto|productos|catalogo|cat[aá]logo|hotel|habitaci|cuarto|suite|room|tarifa|precio|price|reserva|reservation|destino|resort|amenidad|men[uú]|platillo|restaurant|especialidad|doctor|doctora|especialistas|clinica|cl[ií]nica|curso|programa|admisi[oó]n|carrera|tramite|tr[aá]mite|sucursal|ubicaci|location|faq|preguntas|soporte|support|paquete|membres[ií]a|beneficio|servicio-ciudadano/i;
      const prioritized: string[] = [];
      const rest: string[] = [];
      for (const url of sitemapUrls) {
        (HIGH_VALUE.test(url) ? prioritized : rest).push(url);
      }
      const ordered = [...prioritized, ...rest];
      for (const url of ordered) {
        const clean = canonicalizeUrl(url);
        if (knownUrls.has(clean) || !isCrawlableUrl(clean)) continue;
        const id = `source_${crypto.randomUUID()}`;
        knownUrls.add(clean);
        queue.push({ id, url: clean });
        await env.DB.prepare(
          `INSERT OR IGNORE INTO knowledge_sources (id, tenant_id, url, title, status)
           VALUES (?, ?, ?, ?, 'pending')`,
        )
          .bind(id, tenantId, clean, "")
          .run();
        discovered += 1;
        if (queue.length >= maxPages * 2) break;
      }
    } catch {
      // sitemap.xml opcional \u2014 no bloqueamos scan si no existe
    }
  }

  while (queue.length && scanned + failed < maxPages) {
    const source = queue.shift();
    if (!source || visited.has(source.url) || !isCrawlableUrl(source.url)) continue;
    visited.add(source.url);

    try {
      const response = await fetch(source.url, {
        cf: { cacheTtl: 300 },
        headers: { "user-agent": "Mozilla/5.0 AngaFlow-Scanner/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const text = await response.text();
      const page = extractPageFacts(text, source.url);
      for (const link of discoverCorporateLinks(text, source.url)) {
        const linkUrl = canonicalizeUrl(link.url);
        if (knownUrls.has(linkUrl) || !isCrawlableUrl(linkUrl)) continue;
        const id = `source_${crypto.randomUUID()}`;
        knownUrls.add(linkUrl);
        queue.push({ id, url: linkUrl });
        await env.DB.prepare(
          `INSERT OR IGNORE INTO knowledge_sources (id, tenant_id, url, title, status)
           VALUES (?, ?, ?, ?, 'pending')`,
        )
          .bind(id, tenantId, linkUrl, link.title)
          .run();
        discovered += 1;
      }

      await env.DB.prepare(
       `UPDATE knowledge_sources
            SET status = 'scanned', title = ?, summary = ?, updated_at = strftime('%s','now')
          WHERE id = ?`,
      )
        .bind(page.title, page.summary, source.id)
        .run();
      scanned += 1;

      // Vectorize (fase 2): indexamos el fragmento inmediatamente
      // despu\u00e9s de persistirlo. Si falla, no interrumpe el scan — FTS5
      // sigue funcionando como fallback. Idempotente v\u00eda upsert.
      if (env.RAG_ENABLED === "true" && page.summary) {
        await indexKnowledgeSource(env, {
          id: source.id,
          tenantId,
          url: source.url,
          title: page.title,
          summary: page.summary,
        });
      }
    } catch (error) {
      await env.DB.prepare(
        `UPDATE knowledge_sources
            SET status = 'error', summary = ?, updated_at = strftime('%s','now')
          WHERE id = ?`,
      )
        .bind(error instanceof Error ? error.message : String(error), source.id)
        .run();
      failed += 1;
    }
  }

  await refreshKnowledgeProfile(env, tenantId);
  await createSmartFlowFromKnowledge(env, tenantId);
  return { ok: failed === 0, scanned, discovered, failed };
}

async function createDefaultFlow(env: Env, tenantId: string, businessName: string, language: string, timezone: string, assistantName: string): Promise<void> {
  // Idempotente: no-op si el tenant ya tiene un draft por canal (respeta el
  // \u00edndice \u00fanico parcial idx_agent_flows_one_draft).
  const existing = await env.DB.prepare(
    "SELECT id FROM agent_flows WHERE tenant_id = ? AND channel = 'voice' AND status = 'draft' LIMIT 1",
  )
    .bind(tenantId)
    .first<{ id: string }>();
  if (existing) return;

  const flowId = `flow_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO agent_flows (
       id, tenant_id, channel, version, status, greeting, confirmation_template, completion_message, fallback_message, speech_hints, settings
     ) VALUES (?, ?, 'voice', '1.0.0', 'draft', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      flowId,
      tenantId,
      `Gracias por llamar a ${businessName}. Soy ${assistantName}. Te ayudo a canalizar tu solicitud con el equipo correcto. Para empezar, ¿me regalas tu nombre?`,
      "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
      "Listo, quedó registrada tu solicitud. Una persona del equipo dará seguimiento. Que tengas buen día.",
      "Perdón, no te escuché bien. ¿Me lo repites un poco más despacio?",
      JSON.stringify(["asesoría", "información", "servicio", "soporte", "ventas", "agenda", "cita", "mañana", "tarde", "nombre", "hora"]),
      JSON.stringify({ assistant_name: assistantName, business_name: businessName, language, voice: "Polly.Mia-Neural", time_zone: timezone, speechTimeout: "2", timeout: "6" }),
    )
    .run();

  const steps = [
    [1, "nombre_cliente", "¿Me regalas tu nombre, por favor?"],
    [2, "motivo", "¿Sobre qué servicio o tema estás interesado?"],
    [3, "fecha_hora", "Gracias. ¿Qué día y a qué hora te gustaría que te contacte una persona del equipo?"],
  ] as const;

  for (const [order, slot, prompt] of steps) {
    await env.DB.prepare(
      `INSERT INTO flow_steps (id, flow_id, step_order, slot_key, prompt)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(`step_${crypto.randomUUID()}`, flowId, order, slot, prompt)
      .run();
  }
}

async function createSmartFlowFromKnowledge(env: Env, tenantId: string): Promise<void> {
  const tenant = await env.DB.prepare("SELECT name, vertical, language, timezone FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ name: string; vertical: string; language: string; timezone: string }>();
  if (!tenant) return;

  const [services, latestFlow, sources] = await Promise.all([
    env.DB.prepare(
      `SELECT name, description
         FROM tenant_services
        WHERE tenant_id = ?
        ORDER BY priority ASC, name ASC
        LIMIT 10`,
    )
      .bind(tenantId)
      .all<{ name: string; description: string }>(),
    env.DB.prepare(
      `SELECT settings
         FROM agent_flows
        WHERE tenant_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
      .bind(tenantId)
      .first<{ settings: string | null }>(),
    env.DB.prepare(
      `SELECT url, title FROM knowledge_sources
        WHERE tenant_id = ? AND status = 'scanned'`,
    )
      .bind(tenantId)
      .all<{ url: string; title: string | null }>(),
  ]);

  const serviceRows = services.results ?? [];
  if (!serviceRows.length) return;

  const settings = parseJsonRecord(latestFlow?.settings ?? null);
  const assistantName = stringFrom(settings.assistant_name, "Asistente virtual");
  const serviceNames = serviceRows.map((service) => service.name);
  const serviceList = serviceNames.slice(0, 6).join(", ");
  const primaryService = serviceNames[0] ?? "asesoría";

  // Menu topics: agrupamos las URLs y titulos escaneados en 3-4 buckets
  // amplios que el bot puede ofrecer despu\u00e9s del nombre. La idea es
  // "\u00bfSobre qu\u00e9 te ayudo: X, Y o Z?" en lugar de listar 12 servicios.
  const menuTopics = deriveMenuTopics(sources.results ?? [], serviceNames);

  const menuLine = menuTopics.length >= 2
    ? ` Te puedo ayudar con ${joinWithOr(menuTopics)}, o si prefieres, con otra cosa.`
    : "";

  await createFlowDraft(
    env,
    tenantId,
    {
      id: "scan-smart-draft",
      vertical: tenant.vertical,
      level: "recommended",
      name: "Flow inteligente post-scan",
      description: "Draft generado a partir de los servicios detectados durante el escaneo del sitio.",
      greeting: `Gracias por llamar a ${tenant.name}. Soy ${assistantName}. ¿Me compartes tu nombre para orientarte mejor?`,
      confirmationTemplate: `Confirmo una solicitud para {nombre_cliente}, {fecha_hora}, sobre {motivo}. La intención es conectar tu necesidad con el área correcta de ${tenant.name}. ¿Es correcto?`,
      completionMessage: "Listo, tu solicitud quedó registrada con el contexto del servicio que buscas. El equipo adecuado dará seguimiento.",
      fallbackMessage: `Perdón, quiero ubicar bien el servicio que necesitas. Puede ser algo como ${primaryService}. ¿Me lo repites en una frase corta?`,
      speechHints: [...new Set(["asesoría", "consulta", "servicio", "cita", "seguimiento", ...serviceNames, ...menuTopics])].slice(0, 40),
      steps: [
        { slotKey: "nombre_cliente", prompt: "¿Me compartes tu nombre, por favor?" },
        {
          slotKey: "motivo",
          prompt: menuLine
            ? `Perfecto.${menuLine} ¿Qu\u00e9 necesitas?`
            : `¿Qué servicio necesitas? Puedes mencionar alguno como ${serviceList}.`,
        },
        { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para que el equipo te contacte?" },
      ],
    },
    tenant.name,
    tenant.language,
    tenant.timezone,
    assistantName,
    menuTopics,
  );
}

// Buckets sem\u00e1nticos comunes en negocios LATAM. Cada bucket tiene
// patrones que matcheamos contra URLs y t\u00edtulos escaneados. Devolvemos
// s\u00f3lo los buckets que tengan al menos una p\u00e1gina.
const MENU_BUCKETS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "servicios", patterns: [/servicio|solution|soluci[oó]n|producto|platform|plataforma/i] },
  { label: "instalaciones y horarios", patterns: [/instalaci[oó]n|horario|ubicaci[oó]n|sucursal|contacto|contact|direcci[oó]n/i] },
  { label: "precios y promociones", patterns: [/precio|price|tarifa|promoci[oó]n|promo|oferta|descuento|paquete/i] },
  { label: "preguntas frecuentes", patterns: [/faq|preguntas|frecuentes|ayuda|soporte|support/i] },
  { label: "amenidades y experiencias", patterns: [/amenidad|experiencia|actividad|alberca|spa|restaurante|habitaci[oó]n/i] },
  { label: "\u00e1reas de pr\u00e1ctica", patterns: [/practica|pr[aá]ctica|area de pr|areas de pr|derecho|legal/i] },
  { label: "casos y resultados", patterns: [/caso|resultado|portafolio|clientes|testimon/i] },
];

function deriveMenuTopics(
  sources: Array<{ url: string; title: string | null }>,
  serviceNames: string[],
): string[] {
  const hits = new Set<string>();
  for (const source of sources) {
    const haystack = `${source.url} ${source.title ?? ""}`.toLowerCase();
    for (const bucket of MENU_BUCKETS) {
      if (bucket.patterns.some((pattern) => pattern.test(haystack))) {
        hits.add(bucket.label);
      }
    }
  }
  const topics = Array.from(hits);
  // Si no detectamos buckets pero s\u00ed hay servicios, usamos "servicios"
  // como fallback \u00fanico.
  if (!topics.length && serviceNames.length) {
    topics.push("servicios");
  }
  return topics.slice(0, 4);
}

function joinWithOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} o ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} o ${items.at(-1)}`;
}

async function upsertVoiceChannel(env: Env, tenantId: string, voiceNumber?: string): Promise<void> {
  if (!voiceNumber) return;
  await env.DB.prepare(
    `INSERT INTO tenant_channels (id, tenant_id, channel, address, provider, status, settings)
     VALUES (?, ?, 'voice', ?, 'twilio', 'active', '{}')
     ON CONFLICT(channel, address) DO UPDATE SET tenant_id = excluded.tenant_id, status = 'active'`,
  )
    .bind(`channel_${crypto.randomUUID()}`, tenantId, voiceNumber)
    .run();
}

function buildFlowDraft(input: SaveFlowInput, businessName: string, vertical: string): FlowTemplate | { error: string } {
  if (input.templateId) {
    const template = getTemplateById(input.templateId);
    if (!template) {
      return { error: "Template not found" };
    }
    return fillBusinessName(template, businessName);
  }

  if (input.customFlow) {
    const fallback = getTemplatesForVertical(vertical)[0] ?? flowTemplates[0];
    const custom = input.customFlow;
    const steps = Array.isArray(custom.steps) ? custom.steps : fallback.steps;
    if (!steps.length || steps.some((step) => !step.slotKey || !step.prompt?.trim())) {
      return { error: "Custom flow requires valid steps" };
    }
    return fillBusinessName(
      {
        id: "custom",
        vertical,
        level: "advanced",
        name: custom.name?.trim() || "Flow custom",
        description: custom.description?.trim() || "Flow configurado manualmente desde Studio.",
        greeting: custom.greeting?.trim() || fallback.greeting,
        confirmationTemplate: custom.confirmationTemplate?.trim() || fallback.confirmationTemplate,
        completionMessage: custom.completionMessage?.trim() || fallback.completionMessage,
        fallbackMessage: custom.fallbackMessage?.trim() || fallback.fallbackMessage,
        speechHints: Array.isArray(custom.speechHints) ? custom.speechHints.filter((hint) => typeof hint === "string" && hint.trim()).slice(0, 40) : fallback.speechHints,
        steps: steps.slice(0, 8).map((step) => ({ slotKey: step.slotKey, prompt: step.prompt.trim(), retryPrompt: step.retryPrompt?.trim() })),
      },
      businessName,
    );
  }

  return { error: "templateId or customFlow required" };
}

async function createFlowDraft(env: Env, tenantId: string, template: FlowTemplate, businessName: string, language: string, timezone: string, assistantName: string, menuTopics: string[] = []): Promise<string> {
  // UPSERT semantics: cada tenant tiene exactamente un draft por canal. El
  // \u00edndice parcial idx_agent_flows_one_draft (migration 0003) garantiza la
  // invariante a nivel D1; aqu\u00ed reutilizamos la fila existente si existe para
  // preservar su UUID (y as\u00ed su historial de flow_steps antes de reescribirlos).
  const channel = "voice";
  const existing = await env.DB.prepare(
    "SELECT id FROM agent_flows WHERE tenant_id = ? AND channel = ? AND status = 'draft' LIMIT 1",
  )
    .bind(tenantId, channel)
    .first<{ id: string }>();

  const flowId = existing?.id ?? `flow_${crypto.randomUUID()}`;
  const greeting = syncAssistantName(template.greeting, assistantName);
  const settingsJson = JSON.stringify({
    assistant_name: assistantName,
    business_name: businessName,
    language,
    voice: "Polly.Mia-Neural",
    time_zone: timezone,
    speechTimeout: "2",
    timeout: "6",
    template_id: template.id,
    template_name: template.name,
  });
  const speechHintsJson = JSON.stringify(template.speechHints);
  const menuTopicsJson = JSON.stringify(menuTopics);
  const version = `1.0.${Date.now()}`;

  if (existing) {
    await env.DB.prepare(
      `UPDATE agent_flows
          SET version = ?,
              greeting = ?,
              confirmation_template = ?,
              completion_message = ?,
              fallback_message = ?,
              speech_hints = ?,
              settings = ?,
              menu_topics = ?,
              updated_at = strftime('%s','now')
        WHERE id = ?`,
    )
      .bind(
        version,
        greeting,
        template.confirmationTemplate,
        template.completionMessage,
        template.fallbackMessage,
        speechHintsJson,
        settingsJson,
        menuTopicsJson,
        flowId,
      )
      .run();
    // Rewrite flow_steps para reflejar el template actual del draft.
    await env.DB.prepare("DELETE FROM flow_steps WHERE flow_id = ?").bind(flowId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO agent_flows (
         id, tenant_id, channel, version, status, greeting, confirmation_template, completion_message, fallback_message, speech_hints, settings, menu_topics
       ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        flowId,
        tenantId,
        channel,
        version,
        greeting,
        template.confirmationTemplate,
        template.completionMessage,
        template.fallbackMessage,
        speechHintsJson,
        settingsJson,
        menuTopicsJson,
      )
      .run();
  }

  for (const [index, step] of template.steps.entries()) {
    await env.DB.prepare(
      `INSERT INTO flow_steps (id, flow_id, step_order, slot_key, prompt, retry_prompt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(`step_${crypto.randomUUID()}`, flowId, index + 1, step.slotKey, step.prompt, step.retryPrompt ?? null)
      .run();
  }
  return flowId;
}

function fillBusinessName(template: FlowTemplate, businessName: string): FlowTemplate {
  const fill = (value: string) => value.replaceAll("{business_name}", businessName);
  return {
    ...template,
    greeting: fill(template.greeting),
    confirmationTemplate: fill(template.confirmationTemplate),
    completionMessage: fill(template.completionMessage),
    fallbackMessage: fill(template.fallbackMessage),
    steps: template.steps.map((step) => ({ ...step, prompt: fill(step.prompt), retryPrompt: step.retryPrompt ? fill(step.retryPrompt) : undefined })),
  };
}

async function refreshKnowledgeProfile(env: Env, tenantId: string): Promise<void> {
  const [tenant, sources] = await Promise.all([
    env.DB.prepare("SELECT name, vertical, website FROM tenants WHERE id = ?").bind(tenantId).first<{ name: string; vertical: string; website: string | null }>(),
    env.DB.prepare(
      `SELECT id, url, title, summary
         FROM knowledge_sources
        WHERE tenant_id = ? AND status = 'scanned' AND summary IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 16`,
    )
      .bind(tenantId)
      .all<KnowledgeSourceRow>(),
  ]);

  if (!tenant) return;

  const sourceRows = sources.results ?? [];
  const combined = sourceRows.map((source) => `${source.title ?? source.url}: ${source.summary ?? ""}`).join(" ");
  const keywords = extractKeywords(combined || `${tenant.name} ${tenant.vertical}`);
  const businessSummary = summarizeForProfile(tenant.name, tenant.vertical, combined);
  const valueProposition = `Solución conversacional para ${tenant.name} basada en información pública del sitio y rutas corporativas escaneadas.`;

  await env.DB.prepare(
    `INSERT INTO knowledge_profiles (tenant_id, business_summary, value_proposition, primary_cta, keywords)
     VALUES (?, ?, ?, 'Solicitar asesoría', ?)
     ON CONFLICT(tenant_id) DO UPDATE SET
       business_summary = excluded.business_summary,
       value_proposition = excluded.value_proposition,
       keywords = excluded.keywords,
       updated_at = strftime('%s','now')`,
  )
    .bind(tenantId, businessSummary, valueProposition, JSON.stringify(keywords))
    .run();

  const serviceCandidates = sourceRows.filter((source) => isLikelyServiceUrl(source.url) || /servicio|solution|soluci[oó]n|producto|platform|plataforma/i.test(source.title ?? ""));
  const detectedServices = uniqueServices(serviceCandidates.flatMap((source) => servicesFromSource(source))).slice(0, 20);
  const detectedNames = detectedServices.map((service) => service.name);

  // UPSERT por (tenant_id, name): actualiza descripcion/keywords/priority sin
  // duplicar filas ni perder ids historicos. La invariante la respalda el
  // indice unico idx_tenant_services_tenant_name (migration 0004).
  for (const [index, service] of detectedServices.entries()) {
    await env.DB.prepare(
      `INSERT INTO tenant_services (id, tenant_id, name, description, keywords, priority, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, name) DO UPDATE SET
         description = excluded.description,
         keywords = excluded.keywords,
         priority = excluded.priority,
         source_url = excluded.source_url`,
    )
      .bind(
        `service_${crypto.randomUUID()}`,
        tenantId,
        service.name,
        service.description,
        JSON.stringify(extractKeywords(`${service.name} ${service.description}`)),
        (index + 1) * 10,
        service.sourceUrl,
      )
      .run();
  }

  // Purga servicios detectados en scans anteriores que ya no aparecen. Evita
  // que servicios stale queden como "activos" y desalinien el catalogo con el
  // sitio real. Sin nombres, no-op para no borrar catalogo manual.
  if (detectedNames.length) {
    const placeholders = detectedNames.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM tenant_services WHERE tenant_id = ? AND name NOT IN (${placeholders})`,
    )
      .bind(tenantId, ...detectedNames)
      .run();
  }
}

function extractPageFacts(html: string, url: string): { title: string; summary: string } {
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || new URL(url).hostname;
  return {
    title: normalizeText(stripTags(title)).slice(0, 140),
    summary: summarizeText(html),
  };
}

function discoverCorporateLinks(html: string, baseUrl: string): Array<{ url: string; title: string }> {
  const base = new URL(baseUrl);
  const links = new Map<string, string>();
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html))) {
    const href = match[1];
    const label = normalizeText(stripTags(match[2]));
    try {
      const url = new URL(href, base);
      const cleanUrl = canonicalizeUrl(url.toString());
      const parsed = new URL(cleanUrl);
      if (parsed.hostname !== base.hostname || !isCorporatePath(parsed.pathname, label)) continue;
      links.set(cleanUrl, label || parsed.pathname);
    } catch {
      continue;
    }
  }
  return [...links.entries()].slice(0, 60).map(([url, title]) => ({ url, title }));
}

// Multi-tenant, multi-vertical: usamos denylist en vez de allowlist.
// El allowlist previo estaba casado con vertical legal/B2B y romp\u00eda
// hoteler\u00eda, salud, retail, educaci\u00f3n, gobierno, restaurantes, etc.
// Ahora aceptamos toda ruta interna EXCEPTO basura obvia
// (est\u00e1ticos, admin, avisos legales, feeds, taxonom\u00edas, i18n stubs).
function isCorporatePath(pathname: string, label: string): boolean {
  const value = `${pathname} ${label}`.toLowerCase();
  // Est\u00e1ticos y assets
  if (/\/wp-content|\/wp-admin|\/wp-json|\/wp-includes|\/cdn-cgi|\/assets\/|\/static\/|\/dist\/|\/build\/|\/_next\/|\/_nuxt\/|\/node_modules\/|\/fonts?\/|\/images?\/|\/img\/|\/media\/|\/uploads\//.test(value)) return false;
  // Autenticaci\u00f3n / admin
  if (/\/login|\/logout|\/signin|\/signup|\/register|\/admin|\/dashboard|\/mi-cuenta|\/my-account|\/checkout|\/carrito|\/cart|\/wishlist/.test(value)) return false;
  // Legales / boilerplate
  if (/aviso-de-privacidad|aviso-privacidad|politica-de-privacidad|privacy-policy|privacy|terms|terminos|t[eé]rminos-y-condiciones|cookies?|sitemap|mapa-del-sitio|robots\.txt|copyright|derechos-reservados/.test(value)) return false;
  // Feeds y taxonom\u00edas de blog
  if (/\/feed\/?$|\/rss|\/atom|\/tag\/|\/tags\/|\/author\/|\/category\/|\/categoria\/|\/categor[ií]as\//.test(value)) return false;
  // Redes sociales externas embebidas como links internos falsos
  if (/facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|whatsapp\.com/.test(value)) return false;
  // Placeholders comunes
  if (/^\/#|javascript:|mailto:|tel:/.test(value)) return false;
  return true;
}

function isLikelyServiceUrl(url: string): boolean {
  return /servicio|servicios|solution|solutions|solucion|soluciones|producto|productos|platform|plataforma|practica|práctica|practicas|prácticas|area|área|areas|áreas|derecho|legal/i.test(url);
}

// Extrae el texto \u00fatil de una p\u00e1gina web para RAG. Antes solo usaba
// <meta description> cuando exist\u00eda \u2014 pero eso es SEO boilerplate de
// 100-200 chars y NUNCA contiene el contenido real ("reconocimientos",
// "estrategia", "valores", etc.). Ahora combinamos:
//   1. Meta description (contexto general del SEO)
//   2. Body limpio (contenido real: h1-h6, p, li, main, article, section)
// hasta 5000 chars totales. Esto es lo que se embebe en el vector.
function summarizeText(html: string): string {
  const metaDescription =
    firstMatch(html, /<meta\s+[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || firstMatch(html, /<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);

  // Contenido del body: limpiamos script/style/svg/nav/header/footer/aside
  // y colapsamos whitespace. NO usamos solo meta description porque es
  // demasiado corta para RAG (150 chars vs 5000).
  const bodyText = normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<form[\s\S]*?<\/form>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

  const meta = metaDescription ? normalizeText(metaDescription) : "";
  const combined = meta && bodyText
    ? `${meta}\n\n${bodyText}`
    : (bodyText || meta);
  // 12000 chars \u2248 3000-4000 tokens: suficiente para p\u00e1ginas ricas
  // (nosotros, servicios, catalogos) sin explotar los embeddings.
  // bge-m3 acepta hasta 8192 tokens de input y truncar\u00e1 si sobra.
  return combined.slice(0, 12000);
}

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

// Lee /sitemap.xml y /sitemap_index.xml (recursivo un nivel).
// Extrae URLs de <loc> tags. L\u00edmite 500 URLs para evitar sitios enormes.
async function tryReadSitemap(origin: string): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const collected: string[] = [];
  for (const candidate of candidates) {
    try {
      // Algunos sitios (ej. Cloudflare-protected) devuelven 403 pero
      // igual sirven el XML. Aceptamos el body si parece XML v\u00e1lido.
      const response = await fetch(candidate, {
        cf: { cacheTtl: 300 },
        headers: { "user-agent": "Mozilla/5.0 AngaFlow-Scanner/1.0" },
      });
      const xml = await response.text();
      if (!/<urlset|<sitemapindex|<loc>/i.test(xml)) continue;
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      for (const loc of locs) {
        if (collected.length >= 500) break;
        // Si el loc apunta a otro sitemap (index), lo seguimos un nivel.
        if (/\.xml(\?|$)/i.test(loc) && collected.length < 400) {
          try {
            const sub = await fetch(loc, {
              cf: { cacheTtl: 300 },
              headers: { "user-agent": "Mozilla/5.0 AngaFlow-Scanner/1.0" },
            });
            const subXml = await sub.text();
            if (/<loc>/i.test(subXml)) {
              const subLocs = [...subXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
              collected.push(...subLocs.filter((u) => !/\.xml(\?|$)/i.test(u)));
            }
          } catch { /* skip */ }
        } else {
          collected.push(loc);
        }
      }
      if (collected.length > 0) break;
    } catch {
      continue;
    }
  }
  return collected.slice(0, 500);
}

function isCrawlableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !/\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|mp4|mov|mp3|wav|css|js|woff2?|ttf|ico)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function summarizeForProfile(name: string, vertical: string, text: string): string {
  const summary = text ? text.slice(0, 500) : "sin contenido escaneado todavía";
  return `${name} opera en la vertical ${vertical}. Perfil generado a partir del sitio web: ${summary}`;
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set(["para", "con", "del", "las", "los", "una", "por", "que", "como", "desde", "esta", "este", "sobre", "your", "and", "the", "with"]);
  const words = normalizeText(text)
    .toLowerCase()
    .match(/[a-záéíóúñü0-9]{4,}/g) ?? [];
  return [...new Set(words.filter((word) => !stopwords.has(word)))].slice(0, 24);
}

function cleanServiceName(value: string): string {
  const cleaned = normalizeText(value)
    .replace(/\s*\|\s*.*/, "")
    .replace(/\s*-\s*.*/, "")
    .replace(/^más info$/i, "")
    .slice(0, 80);
  return cleaned || "Servicio detectado";
}

function detectServiceName(source: KnowledgeSourceRow): string {
  const summaryTitle = extractSummaryTitle(source.summary ?? "");
  const title = cleanServiceName(source.title ?? "");
  if (summaryTitle && (isGenericLinkTitle(title) || summaryTitle.length > title.length + 8 || /consultor/i.test(title))) {
    return summaryTitle;
  }
  return isGenericLinkTitle(title) ? serviceNameFromUrl(source.url) : title;
}

function extractSummaryTitle(summary: string): string | undefined {
  const normalized = normalizeText(summary).replace(/^-->/, "").trim();
  const beforePipe = normalized.match(/^([^|]{8,90})\s+\|\s+/)?.[1];
  if (beforePipe) {
    return cleanServiceName(beforePipe);
  }
  return undefined;
}

function isGenericLinkTitle(value: string): boolean {
  return /^(más info|ver más|leer más|conoce más|solicita|contacto|servicio detectado)$/i.test(value.trim());
}

function serviceNameFromUrl(value: string): string {
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "servicio-detectado";
    return last.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  } catch {
    return "Servicio detectado";
  }
}

function cleanServiceDescription(summary: string | null, url: string): string {
  const cleaned = normalizeText(summary ?? "")
    .replace(/^-->\s*[^|]{1,120}\|\s*[^\s]+(?:\s+[^\s]+){0,4}\s*/i, "")
    .replace(/^top of page\s*/i, "")
    .replace(/Servicios\s+Cómputo y DaaS\s+Redes y Seguridad\s+Videocolaboración\s+Servidores y Nube\s+SOC & NOC\s+Pantallas Digitales\s+Arrendamiento TI\s+Nosotros\s+Reconocimientos\s+Estrategia y Valor\s+¿Estás bajo ataque\?\s+Hablemos Hoy\s*/i, "")
    .slice(0, 360);
  return cleaned || `Servicio detectado desde ${url}`;
}

function servicesFromSource(source: KnowledgeSourceRow): Array<{ name: string; description: string; sourceUrl: string }> {
  if (isPracticeAreasSource(source)) {
    const practices = extractLegalPracticeAreas(source.summary ?? "");
    if (practices.length) {
      return practices.map((name) => ({
        name,
        description: descriptionForPracticeArea(name, source.summary ?? ""),
        sourceUrl: source.url,
      }));
    }
  }

  const name = detectServiceName(source);
  return [{ name, description: cleanServiceDescription(source.summary, source.url), sourceUrl: source.url }];
}

function isPracticeAreasSource(source: KnowledgeSourceRow): boolean {
  return /areas?-de-practica|áreas?-de-práctica|practica|práctica/i.test(`${source.url} ${source.title ?? ""}`);
}

function extractLegalPracticeAreas(summary: string): string[] {
  const text = normalizeText(summary);
  const matches = [
    ...text.matchAll(/\bDerecho\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?/g),
    ...text.matchAll(/\bLitigio\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?/g),
    ...text.matchAll(/\bCompliance\b/g),
  ].map((match) => cleanServiceName(match[0]));

  const ignored = new Set(["Derecho Legal", "Derecho Abogados"]);
  return [...new Set(matches.filter((name) => name.length > 4 && !ignored.has(name)))].slice(0, 12);
}

function descriptionForPracticeArea(name: string, summary: string): string {
  const text = cleanServiceDescription(summary, "");
  const start = text.indexOf(name);
  if (start < 0) {
    return `Asesoría legal especializada en ${name}.`;
  }

  const nextPractice = text.slice(start + name.length).search(/\b(?:Derecho\s+[A-ZÁÉÍÓÚÑ]|Litigio\s+[A-ZÁÉÍÓÚÑ]|Compliance\b)/);
  const end = nextPractice >= 20 ? start + name.length + nextPractice : start + 320;
  const snippet = text.slice(start, end).replace(new RegExp(`^${escapeRegExp(name)}\\s*`, "i"), "").trim();
  return snippet ? snippet.slice(0, 360) : `Asesoría legal especializada en ${name}.`;
}

function uniqueServices(services: Array<{ name: string; description: string; sourceUrl: string }>): Array<{ name: string; description: string; sourceUrl: string }> {
  const seen = new Set<string>();
  return services.filter((service) => {
    const key = service.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMatch(value: string, regex: RegExp): string | undefined {
  return value.match(regex)?.[1];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function syncAssistantName(greeting: string, assistantName: string): string {
  if (!assistantName.trim()) return greeting;
  if (/\bSoy\s+[^.¿?]+[.¿?]/i.test(greeting)) {
    return greeting.replace(/\bSoy\s+[^.¿?]+([.¿?])/i, `Soy ${assistantName}$1`);
  }
  return greeting.replace(/(Gracias por (?:llamar|comunicarte|contactar)[^.]+\.)/i, `$1 Soy ${assistantName}.`);
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    copy: "©",
    eacute: "é",
    gt: ">",
    iacute: "í",
    lt: "<",
    nbsp: " ",
    ntilde: "ñ",
    oacute: "ó",
    quot: '"',
    uacute: "ú",
    aacute: "á",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return namedEntities[entity.toLowerCase()] ?? `&${entity};`;
  });
}

async function audit(env: Env, tenantId: string, actorEmail: string, eventType: string, payload: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events (id, tenant_id, actor_email, event_type, payload)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), tenantId, actorEmail, eventType, JSON.stringify(payload))
    .run();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
