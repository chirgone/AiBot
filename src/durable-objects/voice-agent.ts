// VoiceAgent — Durable Object responsable de:
//   1. Persistencia por llamada (conversations, messages, appointments)
//   2. Orquestación del turno (invocar dialog-manager + persistir resultado)
//   3. Alarmas de inactividad
//
// La lógica de diálogo (state machine, prompts, RAG merge) vive en
// src/agents/. Este archivo NO decide qué decir; solo delega y persiste.

import { DurableObject } from "cloudflare:workers";
import { detectUrgency } from "../agents/slot-extractor";
import { computeNextTurn, type InjectedRagAnswer } from "../agents/dialog-manager";
import { mergeSlots, sanitizeIncomingSlots } from "../agents/slot-validators";
import type {
  ConversationContext,
  ConversationSlots,
  DialogState,
  ProcessTurnResult,
  RuntimePromptConfig,
} from "../types";

// Re-export del tipo para compatibilidad con imports existentes en index.ts.
export type { InjectedRagAnswer };

interface ConversationRow extends Record<string, SqlStorageValue> {
  id: string;
  phone_number: string;
  dialog_state: DialogState;
  nombre_cliente: string | null;
  telefono: string | null;
  fecha_hora: string | null;
  motivo: string | null;
  urgent: number;
  urgency_phrase: string | null;
  turn_count: number;
  pre_qa_state: DialogState | null;
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
          urgent INTEGER NOT NULL DEFAULT 0,
          urgency_phrase TEXT,
          turn_count INTEGER NOT NULL DEFAULT 0,
          pre_qa_state TEXT,
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

      // Migración idempotente: DOs creados antes de v1.4.0 no tienen turn_count,
      // ni pre_qa_state (v1.5.0). Comprobamos ambos en una sola pasada.
      const columns = this.ctx.storage.sql
        .exec<{ name: string }>(`PRAGMA table_info(conversations)`)
        .toArray();
      const columnNames = new Set(columns.map((column) => column.name));
      if (!columnNames.has("turn_count")) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE conversations ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0`,
        );
      }
      if (!columnNames.has("pre_qa_state")) {
        this.ctx.storage.sql.exec(`ALTER TABLE conversations ADD COLUMN pre_qa_state TEXT`);
      }
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
    options?: { maxTurns?: number; ragAnswer?: InjectedRagAnswer },
  ): Promise<ProcessTurnResult> {
    const row = this.getConversationRow(callSid);
    if (!row) {
      throw new Error(`Conversation not found: ${callSid}`);
    }

    const currentSlots = toContext(row).slots;
    const incomingSlots = sanitizeIncomingSlots(currentSlots, extractedSlots, userMessage);
    const slots = mergeSlots(currentSlots, incomingSlots);

    // Sticky urgency: una vez que el usuario expresa urgencia, la conversación queda marcada.
    const turnUrgency = detectUrgency(userMessage);
    const urgent = row.urgent === 1 || turnUrgency.urgent;
    const urgencyPhrase =
      row.urgency_phrase ?? (turnUrgency.urgent ? turnUrgency.phrase ?? null : null);

    const nextTurnCount = row.turn_count + 1;
    const maxTurns = options?.maxTurns ?? 12;
    const turnLimitReached = nextTurnCount >= maxTurns;

    // Delegamos a dialog-manager (función pura, testeable).
    let dialogOutput = computeNextTurn({
      currentState: row.dialog_state,
      previousSlots: currentSlots,
      currentSlots: slots,
      userMessage,
      runtimeConfig,
      ragAnswer: options?.ragAnswer,
    });

    // Límite de turnos: si el usuario no completó antes del máximo, cerramos la
    // llamada con un mensaje amable. Registramos como cancelled para no marcar
    // lead confirmado. La captura parcial queda en la fila para seguimiento manual.
    if (turnLimitReached && !dialogOutput.isComplete) {
      dialogOutput = {
        responseText:
          "Perdón, no logré capturar todos los datos por teléfono. Un agente humano se pondrá en contacto contigo para continuar. Gracias por tu paciencia.",
        nextState: "cancelled",
        missingSlots: dialogOutput.missingSlots,
        isComplete: true,
      };
    }

    // Persist user message
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (conversation_id, role, content, slots_delta) VALUES (?, 'user', ?, ?)",
      callSid,
      userMessage,
      JSON.stringify(extractedSlots),
    );

    // pre_qa_state: guardar estado previo al entrar en answering_question
    // para poder retomarlo. Limpiar al salir.
    let nextPreQaState: DialogState | null = row.pre_qa_state;
    if (dialogOutput.nextState === "answering_question" && row.dialog_state !== "answering_question") {
      nextPreQaState = row.dialog_state;
    } else if (dialogOutput.nextState !== "answering_question") {
      nextPreQaState = null;
    }

    this.ctx.storage.sql.exec(
      `UPDATE conversations
       SET dialog_state = ?, nombre_cliente = ?, telefono = ?, fecha_hora = ?, motivo = ?, urgent = ?, urgency_phrase = ?, turn_count = ?, pre_qa_state = ?, updated_at = strftime('%s','now'), last_message_at = strftime('%s','now')
       WHERE id = ?`,
      dialogOutput.nextState,
      slots.nombre_cliente ?? null,
      slots.telefono ?? row.phone_number,
      slots.fecha_hora ?? null,
      slots.motivo ?? null,
      urgent ? 1 : 0,
      urgencyPhrase,
      nextTurnCount,
      nextPreQaState,
      callSid,
    );

    let appointmentId: string | undefined;
    if (dialogOutput.nextState === "booked") {
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

    // Persist assistant response
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
      callSid,
      dialogOutput.responseText,
    );

    return {
      responseText: dialogOutput.responseText,
      dialogState: dialogOutput.nextState,
      missingSlots: dialogOutput.missingSlots,
      isComplete: dialogOutput.isComplete,
      appointmentId,
      slots: { ...slots, telefono: slots.telefono ?? row.phone_number },
      urgent,
      urgencyPhrase: urgencyPhrase ?? undefined,
      turnCount: nextTurnCount,
      turnLimitReached,
    };
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
        `SELECT id, phone_number, dialog_state, nombre_cliente, telefono, fecha_hora, motivo, urgent, urgency_phrase, turn_count, pre_qa_state
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
