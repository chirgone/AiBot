import { DurableObject } from "cloudflare:workers";
import type { ConversationContext, ConversationSlots, DialogState, ProcessTurnResult, RuntimePromptConfig } from "../types";

interface ConversationRow extends Record<string, SqlStorageValue> {
  id: string;
  phone_number: string;
  dialog_state: DialogState;
  nombre_cliente: string | null;
  telefono: string | null;
  fecha_hora: string | null;
  motivo: string | null;
}

export class VoiceAgent extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          phone_number TEXT NOT NULL,
          dialog_state TEXT NOT NULL DEFAULT 'greeting',
          nombre_cliente TEXT,
          telefono TEXT,
          fecha_hora TEXT,
          motivo TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          last_message_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          call_ended_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(dialog_state);

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          slots_delta TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

        CREATE TABLE IF NOT EXISTS appointments (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          nombre_cliente TEXT NOT NULL,
          telefono TEXT NOT NULL,
          fecha_hora TEXT NOT NULL,
          motivo TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(fecha_hora);
      `);
    });
  }

  async initConversation(callSid: string, phoneNumber: string): Promise<ConversationContext> {
    const existing = this.getConversationRow(callSid);
    if (existing) {
      return toContext(existing);
    }

    this.ctx.storage.sql.exec(
      "INSERT INTO conversations (id, phone_number, dialog_state) VALUES (?, ?, 'greeting')",
      callSid,
      phoneNumber,
    );
    await this.scheduleInactivityAlarm();

    return {
      id: callSid,
      phoneNumber,
      dialogState: "greeting",
      slots: {},
    };
  }

  async getConversationContext(callSid: string): Promise<ConversationContext> {
    const row = this.getConversationRow(callSid);
    if (!row) {
      throw new Error(`Conversation not found: ${callSid}`);
    }
    return toContext(row);
  }

  async processTurn(
    callSid: string,
    userMessage: string,
    extractedSlots: Partial<ConversationSlots>,
    runtimeConfig?: RuntimePromptConfig,
  ): Promise<ProcessTurnResult> {
    const row = this.getConversationRow(callSid);
    if (!row) {
      throw new Error(`Conversation not found: ${callSid}`);
    }

    const currentSlots = toContext(row).slots;
    const knowledgeAnswer = answerKnowledgeQuestion(userMessage, runtimeConfig);
    const incomingSlots = sanitizeIncomingSlots(currentSlots, extractedSlots, userMessage);
    const slots = mergeSlots(currentSlots, {
      ...incomingSlots,
      motivo: incomingSlots.motivo ?? knowledgeAnswer?.serviceName,
    });
    const result = this.nextTurn(row.dialog_state, currentSlots, slots, userMessage, runtimeConfig);

    this.ctx.storage.sql.exec(
      "INSERT INTO messages (conversation_id, role, content, slots_delta) VALUES (?, 'user', ?, ?)",
      callSid,
      userMessage,
      JSON.stringify(extractedSlots),
    );

    this.ctx.storage.sql.exec(
      `UPDATE conversations
       SET dialog_state = ?, nombre_cliente = ?, telefono = ?, fecha_hora = ?, motivo = ?, updated_at = strftime('%s','now'), last_message_at = strftime('%s','now')
       WHERE id = ?`,
      result.dialogState,
      slots.nombre_cliente ?? null,
      slots.telefono ?? row.phone_number,
      slots.fecha_hora ?? null,
      slots.motivo ?? null,
      callSid,
    );

    let appointmentId: string | undefined;
    if (result.dialogState === "booked") {
      appointmentId = this.createAppointment(callSid, {
        ...slots,
        telefono: slots.telefono ?? row.phone_number,
      });
      this.ctx.storage.sql.exec(
        "UPDATE conversations SET call_ended_at = strftime('%s','now') WHERE id = ?",
        callSid,
      );
      await this.clearInactivityAlarm();
    } else {
      await this.scheduleInactivityAlarm();
    }

    this.ctx.storage.sql.exec(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
      callSid,
      result.responseText,
    );

    return { ...result, appointmentId, slots: { ...slots, telefono: slots.telefono ?? row.phone_number } };
  }

  async endConversation(callSid: string, reason: "hangup" | "timeout" | "error"): Promise<void> {
    const state: DialogState = reason === "timeout" ? "cancelled" : "error";
    this.ctx.storage.sql.exec(
      "UPDATE conversations SET dialog_state = ?, call_ended_at = strftime('%s','now') WHERE id = ?",
      state,
      callSid,
    );
    await this.clearInactivityAlarm();
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE conversations
       SET dialog_state = 'cancelled', call_ended_at = strftime('%s','now')
       WHERE call_ended_at IS NULL AND last_message_at < strftime('%s','now') - 180`,
    );
    await this.clearInactivityAlarm();
  }

  private getConversationRow(callSid: string): ConversationRow | undefined {
    return this.ctx.storage.sql
      .exec<ConversationRow>(
        `SELECT id, phone_number, dialog_state, nombre_cliente, telefono, fecha_hora, motivo
         FROM conversations WHERE id = ?`,
        callSid,
      )
      .toArray()[0];
  }

  private createAppointment(callSid: string, slots: ConversationSlots): string {
    if (!slots.nombre_cliente || !slots.telefono || !slots.fecha_hora) {
      throw new Error("Cannot create appointment without required slots");
    }

    const existing = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM appointments WHERE conversation_id = ? LIMIT 1", callSid)
      .toArray()[0];
    if (existing) {
      return existing.id;
    }

    const appointmentId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO appointments (id, conversation_id, nombre_cliente, telefono, fecha_hora, motivo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      appointmentId,
      callSid,
      slots.nombre_cliente,
      slots.telefono,
      slots.fecha_hora,
      slots.motivo ?? null,
    );
    return appointmentId;
  }

  private nextTurn(
    currentState: DialogState,
    previousSlots: ConversationSlots,
    slots: ConversationSlots,
    userMessage: string,
    runtimeConfig?: RuntimePromptConfig,
  ): ProcessTurnResult {
    if (isCancellation(userMessage)) {
      return {
          responseText: "Entendido, cancelo el proceso. Si necesitas algo más, vuelve a llamarnos.",
        dialogState: "cancelled",
        missingSlots: [],
        isComplete: true,
      };
    }

    const knowledgeAnswer = answerKnowledgeQuestion(userMessage, runtimeConfig);
    if (knowledgeAnswer) {
      const inferredService = knowledgeAnswer.serviceName;
      const nextPrompt = nextPromptAfterKnowledge({ ...slots, motivo: slots.motivo ?? inferredService }, runtimeConfig);
      return {
        responseText: limitVoiceText(`${knowledgeAnswer.responseText} ${nextPrompt}`, 420),
        dialogState: "collecting_info",
        missingSlots: getMissingSlots({ ...slots, motivo: slots.motivo ?? inferredService }),
        isComplete: false,
      };
    }

    const missingSlots = getMissingSlots(slots);
    if (!slots.fecha_hora && isUrgentTiming(userMessage)) {
      return {
        responseText: "Entiendo, lo marco como urgente. Para que el equipo pueda contactarte, ¿prefieres hoy en la mañana, hoy en la tarde o mañana?",
        dialogState: "collecting_info",
        missingSlots,
        isComplete: false,
      };
    }
    if (!previousSlots.motivo && slots.motivo && !slots.fecha_hora) {
      return {
        responseText: `${serviceValidationResponse(slots.motivo, runtimeConfig)} ${promptForSlot("fecha_hora", slots, runtimeConfig)}`,
        dialogState: "collecting_info",
        missingSlots,
        isComplete: false,
      };
    }

    if (currentState === "confirming") {
      if (isAffirmative(userMessage) && missingSlots.length === 0) {
        return {
          responseText:
            runtimeConfig?.completionMessage ??
            "Listo, quedó registrada tu solicitud. Un especialista de Alta Sistemas dará seguimiento para ayudarte con una propuesta tecnológica integral para tu operación. Que tengas buen día.",
          dialogState: "booked",
          missingSlots,
          isComplete: true,
        };
      }

      if (hasCorrection(userMessage) && missingSlots.length === 0) {
        return {
          responseText: formatTemplate(
            runtimeConfig?.confirmationTemplate ?? "Perfecto. Queda actualizado: {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
            slots,
          ),
          dialogState: "confirming",
          missingSlots,
          isComplete: false,
        };
      }

      if (isNegative(userMessage)) {
        return {
          responseText: "Claro. Dime el dato correcto: nombre, tema, día u hora.",
          dialogState: "collecting_info",
          missingSlots,
          isComplete: false,
        };
      }
    }

    if (missingSlots.length === 0) {
      return {
        responseText: formatTemplate(
          runtimeConfig?.confirmationTemplate ??
            "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. La idea es revisar una solución tecnológica inteligente y adecuada para tu operación. ¿Es correcto?",
          slots,
        ),
        dialogState: "confirming",
        missingSlots,
        isComplete: false,
      };
    }

    return {
      responseText: promptForSlot(missingSlots[0], slots, runtimeConfig),
      dialogState: "collecting_info",
      missingSlots,
      isComplete: false,
    };
  }

  private async scheduleInactivityAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + 180_000);
    }
  }

  private async clearInactivityAlarm(): Promise<void> {
    const active = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM conversations WHERE call_ended_at IS NULL")
      .one().count;
    if (active === 0) {
      await this.ctx.storage.deleteAlarm();
    }
  }
}

function toContext(row: ConversationRow): ConversationContext {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    dialogState: row.dialog_state,
    slots: {
      nombre_cliente: row.nombre_cliente ?? undefined,
      telefono: row.telefono ?? undefined,
      fecha_hora: row.fecha_hora ?? undefined,
      motivo: row.motivo ?? undefined,
    },
  };
}

function mergeSlots(current: ConversationSlots, incoming: Partial<ConversationSlots>): ConversationSlots {
  const merged = {
    nombre_cliente: incoming.nombre_cliente ?? current.nombre_cliente,
    telefono: incoming.telefono ?? current.telefono,
    fecha_hora: incoming.fecha_hora ?? current.fecha_hora,
    motivo: incoming.motivo ?? current.motivo,
  };
  if (merged.nombre_cliente && merged.motivo && sameNormalizedText(merged.nombre_cliente, merged.motivo)) {
    merged.motivo = undefined;
  }
  return merged;
}

function sanitizeIncomingSlots(current: ConversationSlots, incoming: Partial<ConversationSlots>, userMessage: string): Partial<ConversationSlots> {
  const sanitized = { ...incoming };
  const onlyNeededName = !current.nombre_cliente && isLikelyNameOnly(userMessage);
  if (onlyNeededName) {
    return { nombre_cliente: sanitized.nombre_cliente ?? userMessage.trim() };
  }
  if (sanitized.nombre_cliente && sanitized.motivo && sameNormalizedText(sanitized.nombre_cliente, sanitized.motivo)) {
    sanitized.motivo = undefined;
  }
  return sanitized;
}

function isLikelyNameOnly(message: string): boolean {
  const clean = message.replace(/[.,!?¿¡]/g, " ").replace(/\s+/g, " ").trim();
  const lower = normalizeForSearch(clean);
  if (!clean || /\d/.test(clean)) return false;
  if (/\b(servicio|asesoria|asesoria|consulta|derecho|mercantil|corporativo|compliance|litigio|administrativo|civil|mañana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hora|tarde|noche)\b/.test(lower)) return false;
  const withoutPrefix = lower.replace(/^(me llamo|soy|mi nombre es)\s+/, "");
  const words = withoutPrefix.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4;
}

function getMissingSlots(slots: ConversationSlots): (keyof ConversationSlots)[] {
  const missing: (keyof ConversationSlots)[] = [];
  if (!slots.nombre_cliente) missing.push("nombre_cliente");
  if (!slots.motivo) missing.push("motivo");
  if (!slots.fecha_hora) missing.push("fecha_hora");
  return missing;
}

function promptForSlot(slot: keyof ConversationSlots, slots: ConversationSlots, runtimeConfig?: RuntimePromptConfig): string {
  const configuredPrompt = runtimeConfig?.prompts[slot];
  if (configuredPrompt) {
    return formatTemplate(configuredPrompt, slots);
  }

  switch (slot) {
    case "nombre_cliente":
      return "¿Me regalas tu nombre, por favor?";
    case "fecha_hora":
      return "Gracias. ¿Qué día y a qué hora te gustaría que te contacte un especialista de Alta Sistemas? Por ejemplo, mañana a las cuatro de la tarde.";
    case "motivo":
      return `${slots.nombre_cliente ? `Perfecto, ${slots.nombre_cliente}. ` : ""}${servicePrompt(runtimeConfig)}`;
    case "telefono":
      return "¿Me compartes tu número de teléfono?";
  }
}

function servicePrompt(runtimeConfig?: RuntimePromptConfig): string {
  const services = runtimeConfig?.services?.slice(0, 5).map((service) => service.name).filter(Boolean) ?? [];
  if (services.length) {
    return `Cuéntame qué necesitas o sobre qué servicio quieres información. Puedo orientarte con ${services.join(", ")}.`;
  }
  return "Cuéntame qué necesitas o sobre qué servicio quieres información; con eso te oriento mejor.";
}

function serviceValidationResponse(motivo: string, runtimeConfig?: RuntimePromptConfig): string {
  const service = findMatchingService(motivo, runtimeConfig);
  if (service) {
    return `Sí, ${runtimeConfig?.businessName ?? "el equipo"} puede ayudarte con ${service.name}. ${shortenForVoice(service.description)}`;
  }
  if (runtimeConfig?.services?.length) {
    const names = runtimeConfig.services.slice(0, 4).map((item) => item.name).join(", ");
    return `No veo ese servicio exacto en la información cargada, pero puedo registrar tu solicitud para que el equipo la revise. En el sitio aparecen áreas como ${names}.`;
  }
  return "Puedo registrar tu solicitud para que el equipo la revise y te confirme si aplica.";
}

function findMatchingService(motivo: string, runtimeConfig?: RuntimePromptConfig): RuntimePromptConfig["services"][number] | undefined {
  if (!runtimeConfig?.services?.length) return undefined;
  const lower = normalizeForSearch(motivo);
  return runtimeConfig.services.find((candidate) => {
    const haystack = normalizeForSearch(`${candidate.name} ${candidate.description} ${candidate.keywords.join(" ")}`);
    return haystack.includes(lower) || lower.includes(normalizeForSearch(candidate.name)) || haystack.split(/\s+/).filter((word) => word.length >= 5).some((word) => lower.includes(word));
  });
}

function answerKnowledgeQuestion(message: string, runtimeConfig?: RuntimePromptConfig): { responseText: string; serviceName?: string } | undefined {
  if (!runtimeConfig?.services.length || !looksLikeKnowledgeQuestion(message)) return undefined;
  const lower = normalizeForSearch(message);

  if (/\b(qué|que)\s+(servicios|áreas|areas)|\b(servicios|áreas|areas)\s+(tienen|ofrecen|manejan)/i.test(lower)) {
    const names = runtimeConfig.services.slice(0, 6).map((service) => service.name).join(", ");
    return { responseText: `Sí. ${runtimeConfig.businessName} puede ayudarte con ${names}.` };
  }

  const service = findMatchingService(message, runtimeConfig);

  if (!service) return undefined;
  return {
    serviceName: service.name,
    responseText: `Sí. ${runtimeConfig.businessName} ofrece ${service.name}. ${shortenForVoice(service.description)}`,
  };
}

function nextPromptAfterKnowledge(slots: ConversationSlots, runtimeConfig?: RuntimePromptConfig): string {
  const missing = getMissingSlots(slots);
  if (!missing.length) {
    return formatTemplate(runtimeConfig?.confirmationTemplate ?? "¿Quieres que registre tu solicitud para que el equipo te contacte?", slots);
  }
  return `Para ayudarte mejor, ${promptForSlot(missing[0], slots, runtimeConfig)}`;
}

function looksLikeKnowledgeQuestion(message: string): boolean {
  return /\b(tienen|manejan|ofrecen|hacen|cuentan|servicio|servicios|área|áreas|area|areas|producto|productos|pueden ayudar|me pueden ayudar|qué|que|cuál|cual)\b/i.test(message);
}

function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function shortenForVoice(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.split(/(?<=[.!?])\s+/)[0];
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
}

function limitVoiceText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}.`;
}

function sameNormalizedText(left: string, right: string): boolean {
  return normalizeForSearch(left).replace(/\s+/g, " ").trim() === normalizeForSearch(right).replace(/\s+/g, " ").trim();
}

function formatTemplate(template: string, slots: ConversationSlots): string {
  return template
    .replaceAll("{nombre_cliente}", slots.nombre_cliente ?? "el cliente")
    .replaceAll("{fecha_hora}", formatDateTimeForSpeech(slots.fecha_hora))
    .replaceAll("{motivo}", slots.motivo ?? "la solicitud");
}

function isAffirmative(message: string): boolean {
  return /\b(s[ií]|correcto|claro|ok|okay|perfecto|confirmo|confirmado|as[ií] es|exacto|adelante|de acuerdo|est[aá] bien|sale|va|listo|afirmativo|por favor)\b/i.test(
    message,
  );
}

function isNegative(message: string): boolean {
  return /\b(no|incorrecto|cambiar|corregir|otra hora|otro d[ií]a)\b/i.test(message);
}

function hasCorrection(message: string): boolean {
  return /\b(no|cambia|cambiar|corrige|corregir|mejor|otra hora|otro d[ií]a|ser[ií]a)\b/i.test(message);
}

function isCancellation(message: string): boolean {
  return /\b(cancelar|cancela|olvidalo|olvídalo|ya no|no gracias)\b/i.test(message);
}

function isUrgentTiming(message: string): boolean {
  return /\b(lo antes posible|cuanto antes|urgente|hoy mismo|en cuanto puedan|en cuanto sea posible|lo mas pronto|lo más pronto|pronto)\b/i.test(message);
}

function formatDateTimeForSpeech(value: string | undefined): string {
  if (!value) {
    return "la fecha y hora indicada";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
