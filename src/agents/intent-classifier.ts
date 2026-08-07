// Intent Classifier — heurísticas multi-tenant para clasificar mensajes
// del usuario en la máquina de estados de voz.
//
// Diseño: cero LLM, cero keywords específicas de vertical. Solo patrones
// estructurales que funcionan igual en hoteles, legal, salud, retail, etc.
//
// Responsabilidad única: dado un mensaje + estado actual, retorna el
// tipo de intención. El dialog-manager decide qué hacer con esa intención.

import type { DialogState } from "../types";

export type IntentType =
  | "slot_answer"       // Respuesta trivial a un slot esperado (nombre, número, hora)
  | "knowledge_query"   // Pregunta abierta que amerita RAG
  | "cancellation"      // Usuario quiere cancelar
  | "confirmation"      // Sí / correcto / ok
  | "negation"          // No / incorrecto
  | "correction"        // Cambiar dato previamente confirmado
  | "unknown";          // Continuar flujo normal, extraer slots

export interface IntentClassification {
  type: IntentType;
  // Confidence subjetiva basada en cuán específico fue el patrón.
  // 1.0 = match exacto (ej. "sí"), 0.5 = heurístico (ej. mensaje largo sin patrón).
  confidence: number;
}

export function classifyIntent(message: string, dialogState: DialogState): IntentClassification {
  const trimmed = message.trim();
  if (!trimmed) {
    return { type: "unknown", confidence: 0 };
  }

  if (isCancellation(trimmed)) {
    return { type: "cancellation", confidence: 1.0 };
  }

  // En estado 'confirming', las heurísticas de confirmación/negación tienen
  // prioridad porque el usuario está respondiendo a "¿es correcto?".
  if (dialogState === "confirming") {
    if (isAffirmative(trimmed)) return { type: "confirmation", confidence: 1.0 };
    if (hasCorrection(trimmed)) return { type: "correction", confidence: 0.8 };
    if (isNegative(trimmed)) return { type: "negation", confidence: 0.9 };
  }

  // Slot answer: mensajes triviales que responden un slot esperado.
  // Skipeamos RAG para no gastar latencia + tokens.
  if (looksLikeSlotAnswer(trimmed)) {
    return { type: "slot_answer", confidence: 0.9 };
  }

  // Cualquier otra cosa: puede ser pregunta de conocimiento.
  if (looksLikeKnowledgeQuestion(trimmed)) {
    return { type: "knowledge_query", confidence: 0.6 };
  }

  return { type: "unknown", confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Heurísticas estructurales exportadas (útiles para el orchestrator/worker)
// ---------------------------------------------------------------------------

// Skip RAG si el mensaje es trivialmente una respuesta a un slot.
// Migrado desde index.ts:looksLikeSlotAnswer.
export function looksLikeSlotAnswer(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  // Confirmaciones/negaciones/agradecimientos cortos
  if (/^(s[ií]|no|ok|okey|okay|correcto|as[ií] es|efectivamente|claro|por supuesto|gracias|adi[oó]s|nada m[aá]s|est[aá] bien|de acuerdo|listo|entendido)[\s.!?,]*$/i.test(m)) return true;
  // Solo números (teléfono, cantidad, hora suelta)
  if (/^[\d\s\-+().]+$/.test(m) && m.replace(/\D/g, "").length >= 3) return true;
  // Muy corto sin signo de pregunta — probablemente nombre o palabra suelta
  if (m.length < 6 && !/[?¿]/.test(m)) return true;
  return false;
}

// Detecta preguntas de conocimiento. Migrado desde voice-agent.ts.
// No usa keywords porque cada vertical tiene vocabulario propio.
export function looksLikeKnowledgeQuestion(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  // Confirmaciones y números cortos NO son preguntas
  if (/^(s[ií]|no|ok|okey|correcto|gracias|adi[oó]s|listo|entendido)[\s.!?,]*$/i.test(m)) return false;
  if (/^[\d\s\-+().]+$/.test(m)) return false;
  if (m.length < 6 && !/[?¿]/.test(m)) return false;
  return true;
}

export function isCancellation(message: string): boolean {
  return /\b(cancelar|cancela|olvidalo|olvídalo|ya no|no gracias)\b/i.test(message);
}

export function isAffirmative(message: string): boolean {
  return /\b(s[ií]|correcto|claro|ok|okay|perfecto|confirmo|confirmado|as[ií] es|exacto|adelante|de acuerdo|est[aá] bien|sale|va|listo|afirmativo|por favor)\b/i.test(
    message,
  );
}

export function isNegative(message: string): boolean {
  return /\b(no|incorrecto|cambiar|corregir|otra hora|otro d[ií]a)\b/i.test(message);
}

export function hasCorrection(message: string): boolean {
  return /\b(no|cambia|cambiar|corrige|corregir|mejor|otra hora|otro d[ií]a|ser[ií]a)\b/i.test(message);
}
