import type { RuntimePromptConfig } from "./types";

interface TenantRuntimeRow {
  tenant_id: string;
  tenant_name: string;
  timezone: string;
  language: string;
  business_summary: string | null;
  greeting: string | null;
  confirmation_template: string | null;
  completion_message: string | null;
  fallback_message: string | null;
  speech_hints: string | null;
  settings: string | null;
  notify_webhook_url: string | null;
  notify_webhook_secret: string | null;
}

interface ServiceRow {
  name: string;
  description: string;
  keywords: string;
}

interface FlowStepRow {
  slot_key: string;
  prompt: string;
}

const defaultSpeechHints = [
  "asesoría",
  "propuesta integral",
  "soluciones tecnológicas",
  "cómputo",
  "DaaS",
  "servidores",
  "nube OnPremise",
  "redes",
  "ciberseguridad",
  "SOC",
  "NOC",
  "videocolaboración",
  "arrendamiento tecnológico",
];

export async function resolveRuntimeConfig(env: Env, toPhone?: string): Promise<RuntimePromptConfig> {
  if (!toPhone) {
    return fallbackRuntimeConfig(env);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT t.id AS tenant_id,
              t.name AS tenant_name,
              t.timezone,
              t.language,
              t.notify_webhook_url,
              t.notify_webhook_secret,
              kp.business_summary,
              af.id AS flow_id,
              af.version AS flow_version,
              af.greeting,
              af.confirmation_template,
              af.completion_message,
              af.fallback_message,
              af.speech_hints,
              af.settings,
              af.menu_topics
         FROM tenant_channels tc
         JOIN tenants t ON t.id = tc.tenant_id
         LEFT JOIN knowledge_profiles kp ON kp.tenant_id = t.id
         LEFT JOIN agent_flows af ON af.tenant_id = t.id AND af.channel = tc.channel AND af.status = 'active'
        WHERE tc.address = ? AND tc.channel = 'voice' AND tc.status = 'active' AND t.status = 'active'
        LIMIT 1`,
    )
      .bind(toPhone)
      .first<TenantRuntimeRow & { flow_id: string | null; flow_version: string | null; menu_topics: string | null }>();

    if (!row) {
      console.log(
        JSON.stringify({ message: "runtime config: no tenant matched", toPhone }),
      );
      return fallbackRuntimeConfig(env);
    }

    console.log(
      JSON.stringify({
        message: "runtime config resolved",
        toPhone,
        tenantId: row.tenant_id,
        flowId: row.flow_id,
        flowVersion: row.flow_version,
      }),
    );

    const [services, steps] = await Promise.all([
      env.DB.prepare(
        `SELECT name, description, keywords
           FROM tenant_services
          WHERE tenant_id = ?
          ORDER BY priority ASC, name ASC`,
      )
        .bind(row.tenant_id)
        .all<ServiceRow>(),
      env.DB.prepare(
        `SELECT fs.slot_key, fs.prompt
           FROM flow_steps fs
           JOIN agent_flows af ON af.id = fs.flow_id
          WHERE af.tenant_id = ? AND af.channel = 'voice' AND af.status = 'active'
          ORDER BY fs.step_order ASC`,
      )
        .bind(row.tenant_id)
        .all<FlowStepRow>(),
    ]);

    const settings = parseJsonRecord(row.settings);
    const prompts: RuntimePromptConfig["prompts"] = {};
    for (const step of steps.results ?? []) {
      if (step.slot_key === "nombre_cliente" || step.slot_key === "motivo" || step.slot_key === "fecha_hora" || step.slot_key === "telefono") {
        prompts[step.slot_key] = step.prompt;
      }
    }

    const assistantName = stringFrom(settings.assistant_name, env.ASSISTANT_NAME);
    const fallback = fallbackRuntimeConfig(env);

    return {
      tenantId: row.tenant_id,
      businessName: row.tenant_name,
      assistantName,
      language: row.language || env.LANGUAGE,
      voice: stringFrom(settings.voice, env.VOICE),
      timeZone: row.timezone || env.TIME_ZONE,
      greeting: syncAssistantName(row.greeting || fallback.greeting, assistantName),
      confirmationTemplate: row.confirmation_template || fallback.confirmationTemplate,
      completionMessage: row.completion_message || fallback.completionMessage,
      fallbackMessage: row.fallback_message || fallback.fallbackMessage,
      speechHints: parseStringArray(row.speech_hints, defaultSpeechHints),
      prompts,
      knowledgeSummary: row.business_summary || fallback.knowledgeSummary,
      services: (services.results ?? []).map((service) => ({
        name: service.name,
        description: service.description,
        keywords: parseStringArray(service.keywords, []),
      })),
      menuTopics: parseStringArray(row.menu_topics, []),
      speechTimeout: stringFromOptional(settings.speechTimeout),
      timeout: stringFromOptional(settings.timeout),
      notifyWebhookUrl: row.notify_webhook_url ?? undefined,
      notifyWebhookSecret: row.notify_webhook_secret ?? undefined,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "runtime config lookup failed; using fallback",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return fallbackRuntimeConfig(env);
  }
}

export async function recordConfirmedLead(
  env: Env,
  config: RuntimePromptConfig,
  conversationId: string,
  phone: string,
  slots: { nombre_cliente?: string; telefono?: string; fecha_hora?: string; motivo?: string },
  urgency?: { urgent?: boolean; phrase?: string },
  ctx?: ExecutionContext,
): Promise<void> {
  if (config.tenantId === "fallback") {
    return;
  }

  const urgent = urgency?.urgent ? 1 : 0;
  const metadata: Record<string, unknown> = { appointmentId: conversationId };
  if (urgency?.phrase) {
    metadata.urgencyPhrase = urgency.phrase;
  }

  const leadId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads (id, tenant_id, channel, conversation_id, name, phone, service, requested_at, status, source, metadata, urgent)
     VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, 'confirmed', 'voice', ?, ?)
     ON CONFLICT(tenant_id, conversation_id) DO UPDATE SET
       name = excluded.name,
       phone = excluded.phone,
       service = excluded.service,
       requested_at = excluded.requested_at,
       status = 'confirmed',
       metadata = excluded.metadata,
       urgent = CASE WHEN excluded.urgent = 1 THEN 1 ELSE leads.urgent END,
       updated_at = strftime('%s','now')`,
  )
    .bind(
      leadId,
      config.tenantId,
      conversationId,
      slots.nombre_cliente ?? null,
      slots.telefono ?? phone,
      slots.motivo ?? null,
      slots.fecha_hora ?? null,
      JSON.stringify(metadata),
      urgent,
    )
    .run();

  // Notificacion saliente por tenant. Se corre en waitUntil para no bloquear la
  // respuesta TwiML. Si el tenant no configuro webhook, no-op.
  if (config.notifyWebhookUrl) {
    const notify = deliverLeadNotification(config, {
      leadId,
      conversationId,
      phone: slots.telefono ?? phone,
      name: slots.nombre_cliente ?? null,
      service: slots.motivo ?? null,
      requestedAt: slots.fecha_hora ?? null,
      urgent: urgent === 1,
      urgencyPhrase: urgency?.phrase ?? null,
      timestamp: new Date().toISOString(),
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(notify);
    } else {
      await notify;
    }
  }
}

interface LeadNotificationPayload {
  leadId: string;
  conversationId: string;
  phone: string;
  name: string | null;
  service: string | null;
  requestedAt: string | null;
  urgent: boolean;
  urgencyPhrase: string | null;
  timestamp: string;
}

async function deliverLeadNotification(
  config: RuntimePromptConfig,
  payload: LeadNotificationPayload,
): Promise<void> {
  if (!config.notifyWebhookUrl) return;
  try {
    const body = JSON.stringify({
      event: "lead.confirmed",
      tenantId: config.tenantId,
      businessName: config.businessName,
      lead: payload,
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "AngaFlow-Voice/1.5",
    };
    if (config.notifyWebhookSecret) {
      headers["x-angaflow-signature"] = await hmacSha256Hex(config.notifyWebhookSecret, body);
    }
    const response = await fetch(config.notifyWebhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8_000),
    });
    console.log(
      JSON.stringify({
        message: "lead notify",
        tenantId: config.tenantId,
        leadId: payload.leadId,
        url: config.notifyWebhookUrl,
        status: response.status,
      }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "lead notify failed",
        tenantId: config.tenantId,
        leadId: payload.leadId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackRuntimeConfig(env: Env): RuntimePromptConfig {
  return {
    tenantId: "fallback",
    businessName: env.BUSINESS_NAME,
    assistantName: env.ASSISTANT_NAME,
    language: env.LANGUAGE,
    voice: env.VOICE,
    timeZone: env.TIME_ZONE,
    greeting: `Gracias por llamar a ${env.BUSINESS_NAME}. Soy ${env.ASSISTANT_NAME}. Te ayudo a canalizar tu solicitud con el equipo correcto. Para empezar, ¿me regalas tu nombre?`,
    confirmationTemplate:
      "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
    completionMessage:
      "Listo, quedó registrada tu solicitud. Un especialista dará seguimiento. Que tengas buen día.",
    fallbackMessage: "Perdón, no te escuché bien. ¿Me lo repites un poco más despacio?",
    speechHints: defaultSpeechHints,
    prompts: {},
    knowledgeSummary:
      "AngaFlow configura bots y agentes conversacionales multi-tenant para capturar, calificar y escalar conversaciones de negocio.",
    services: [],
    menuTopics: [],
  };
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

function parseStringArray(value: string | null, fallback: string[]): string[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback;
  } catch {
    return fallback;
  }
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringFromOptional(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function syncAssistantName(greeting: string, assistantName: string): string {
  if (!assistantName.trim()) return greeting;
  if (/\bSoy\s+[^.¿?]+[.¿?]/i.test(greeting)) {
    return greeting.replace(/\bSoy\s+[^.¿?]+([.¿?])/i, `Soy ${assistantName}$1`);
  }
  return greeting.replace(/(Gracias por (?:llamar|comunicarte|contactar)[^.]+\.)/i, `$1 Soy ${assistantName}.`);
}
