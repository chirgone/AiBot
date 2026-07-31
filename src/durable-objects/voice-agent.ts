import { DurableObject } from "cloudflare:workers";
import type { ConversationContext, ConversationSlots, DialogState, ProcessTurnResult } from "../types";

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
  ): Promise<ProcessTurnResult> {
    const row = this.getConversationRow(callSid);
    if (!row) {
      throw new Error(`Conversation not found: ${callSid}`);
    }

    const currentSlots = toContext(row).slots;
    const slots = mergeSlots(currentSlots, extractedSlots);
    const result = this.nextTurn(row.dialog_state, slots, userMessage);

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

    return { ...result, appointmentId };
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
    slots: ConversationSlots,
    userMessage: string,
  ): ProcessTurnResult {
    if (isCancellation(userMessage)) {
      return {
        responseText: "Entendido, cancelo el proceso. Si necesitas algo más, vuelve a llamarnos.",
        dialogState: "cancelled",
        missingSlots: [],
        isComplete: true,
      };
    }

    const missingSlots = getMissingSlots(slots);

    if (currentState === "confirming") {
      if (isAffirmative(userMessage) && missingSlots.length === 0) {
        return {
          responseText: "Listo, quedó agendada. Te esperamos. Que tengas bonito día.",
          dialogState: "booked",
          missingSlots,
          isComplete: true,
        };
      }

      if (isNegative(userMessage)) {
        return {
          responseText: "Claro, sin problema. ¿Qué quieres cambiar: el nombre, el día, la hora o el motivo?",
          dialogState: "collecting_info",
          missingSlots,
          isComplete: false,
        };
      }
    }

    if (missingSlots.length === 0) {
      return {
        responseText: `Perfecto. Tengo registrada una cita para ${slots.nombre_cliente}, ${formatDateTimeForSpeech(slots.fecha_hora)}, por ${slots.motivo}. ¿Es correcto?`,
        dialogState: "confirming",
        missingSlots,
        isComplete: false,
      };
    }

    return {
      responseText: promptForSlot(missingSlots[0], slots),
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
  return {
    nombre_cliente: incoming.nombre_cliente ?? current.nombre_cliente,
    telefono: incoming.telefono ?? current.telefono,
    fecha_hora: incoming.fecha_hora ?? current.fecha_hora,
    motivo: incoming.motivo ?? current.motivo,
  };
}

function getMissingSlots(slots: ConversationSlots): (keyof ConversationSlots)[] {
  const missing: (keyof ConversationSlots)[] = [];
  if (!slots.nombre_cliente) missing.push("nombre_cliente");
  if (!slots.fecha_hora) missing.push("fecha_hora");
  if (!slots.motivo) missing.push("motivo");
  return missing;
}

function promptForSlot(slot: keyof ConversationSlots, slots: ConversationSlots): string {
  switch (slot) {
    case "nombre_cliente":
      return "¿Me regalas tu nombre, por favor?";
    case "fecha_hora":
      return `${slots.nombre_cliente ? `Gracias, ${slots.nombre_cliente}. ` : ""}¿Qué día y a qué hora te gustaría venir? Por ejemplo, mañana a las cuatro de la tarde.`;
    case "motivo":
      return "Perfecto. ¿Qué necesitas hacerte? Puede ser limpieza, revisión, dolor, o algo diferente.";
    case "telefono":
      return "¿Me compartes tu número de teléfono?";
  }
}

function isAffirmative(message: string): boolean {
  return /\b(s[ií]|correcto|claro|ok|okay|perfecto|confirmo|confirmado|as[ií] es|exacto|adelante|de acuerdo|est[aá] bien|sale|va|listo|afirmativo|por favor)\b/i.test(
    message,
  );
}

function isNegative(message: string): boolean {
  return /\b(no|incorrecto|cambiar|corregir|otra hora|otro d[ií]a)\b/i.test(message);
}

function isCancellation(message: string): boolean {
  return /\b(cancelar|cancela|olvidalo|olvídalo|ya no|no gracias)\b/i.test(message);
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
