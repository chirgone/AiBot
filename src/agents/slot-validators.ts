// Slot Validators — validación y sanitización de slots extraídos.
//
// Responsabilidad: dado un mensaje del usuario y slots crudos, aplicar
// reglas de saneamiento (nombres que no son nombres, fechas en el pasado,
// motivo que coincide con nombre_cliente, etc.).
//
// Todas las funciones son puras y sin I/O. No dependen de env ni DO.

import type { ConversationSlots } from "../types";

// Sanea los slots entrantes contra el mensaje original y el estado previo.
// Migrado desde voice-agent.ts.
export function sanitizeIncomingSlots(
  current: ConversationSlots,
  incoming: Partial<ConversationSlots>,
  userMessage: string,
): Partial<ConversationSlots> {
  const sanitized = { ...incoming };

  // Si aún falta el nombre y el mensaje "huele" a solo un nombre,
  // aceptamos el mensaje crudo como nombre y descartamos otros slots.
  const onlyNeededName = !current.nombre_cliente && isLikelyNameOnly(userMessage);
  if (onlyNeededName) {
    return { nombre_cliente: sanitized.nombre_cliente ?? userMessage.trim() };
  }

  // Nombre y motivo iguales: el extractor probablemente confundió al
  // usuario diciendo su nombre con un "motivo". Descartamos motivo.
  if (sanitized.nombre_cliente && sanitized.motivo && sameNormalizedText(sanitized.nombre_cliente, sanitized.motivo)) {
    sanitized.motivo = undefined;
  }

  return sanitized;
}

// Merge de slots current + incoming, aplicando reglas de deduplicación.
// Migrado desde voice-agent.ts:mergeSlots.
export function mergeSlots(current: ConversationSlots, incoming: Partial<ConversationSlots>): ConversationSlots {
  const merged: ConversationSlots = {
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

// Retorna los slots que aún faltan por llenar. Orden: nombre → motivo → fecha.
export function getMissingSlots(slots: ConversationSlots): (keyof ConversationSlots)[] {
  const missing: (keyof ConversationSlots)[] = [];
  if (!slots.nombre_cliente) missing.push("nombre_cliente");
  if (!slots.motivo) missing.push("motivo");
  if (!slots.fecha_hora) missing.push("fecha_hora");
  return missing;
}

// Detecta si el mensaje probablemente contiene solo un nombre propio.
// Migrado desde voice-agent.ts.
export function isLikelyNameOnly(message: string): boolean {
  const clean = message.replace(/[.,!?¿¡]/g, " ").replace(/\s+/g, " ").trim();
  const lower = normalizeForSearch(clean);
  if (!clean || /\d/.test(clean)) return false;
  if (/\b(servicio|asesoria|asesoría|consulta|derecho|mercantil|corporativo|compliance|litigio|administrativo|civil|mañana|hoy|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|hora|tarde|noche)\b/.test(lower)) return false;
  const withoutPrefix = lower.replace(/^(me llamo|soy|mi nombre es)\s+/, "");
  const words = withoutPrefix.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4;
}

// Valida que una fecha ISO no esté en el pasado (margen 5 min).
// Migrado desde voice-agent.ts.
export function isFutureDateTime(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // No parseable → aceptamos para no bloquear con lenguaje natural.
    return true;
  }
  // Margen de 5 minutos para tolerar reloj/latencia.
  return date.getTime() > Date.now() - 5 * 60 * 1000;
}

// Normalización de texto sin acentos, minúsculas, para comparación tolerante.
// Reutilizada por múltiples módulos.
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function sameNormalizedText(left: string, right: string): boolean {
  return normalizeForSearch(left).replace(/\s+/g, " ").trim() === normalizeForSearch(right).replace(/\s+/g, " ").trim();
}
