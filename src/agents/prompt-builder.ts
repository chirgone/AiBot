// Prompt Builder — genera textos hablables que el bot dice al usuario.
//
// Responsabilidad: convertir estado + slots + config de tenant en la
// respuesta textual apropiada. NO decide el estado siguiente (eso es
// dialog-manager). Puro texto + templates.
//
// Todas las funciones aquí son puras y multi-tenant: la fuente de
// personalización es RuntimePromptConfig, nunca env ni globals.

import type { ConversationSlots, RuntimePromptConfig } from "../types";
import { normalizeForSearch } from "./slot-validators";

// Prompt para pedirle al usuario el siguiente slot faltante.
// Migrado desde voice-agent.ts:promptForSlot.
export function promptForSlot(
  slot: keyof ConversationSlots,
  slots: ConversationSlots,
  runtimeConfig?: RuntimePromptConfig,
): string {
  const configuredPrompt = runtimeConfig?.prompts[slot];
  if (configuredPrompt) {
    return formatTemplate(configuredPrompt, slots, runtimeConfig?.timeZone);
  }

  switch (slot) {
    case "nombre_cliente":
      return "¿Me regalas tu nombre, por favor?";
    case "fecha_hora":
      return "Gracias. ¿Qué día y a qué hora te gustaría que te contacte un especialista? Por ejemplo, mañana a las cuatro de la tarde.";
    case "motivo":
      return `${slots.nombre_cliente ? `Perfecto, ${slots.nombre_cliente}. ` : ""}${servicePrompt(runtimeConfig)}`;
    case "telefono":
      return "¿Me compartes tu número de teléfono?";
  }
}

// Prompt genérico para preguntar por servicio/tema.
// Usa la lista de servicios del tenant si está disponible.
export function servicePrompt(runtimeConfig?: RuntimePromptConfig): string {
  const services = runtimeConfig?.services?.slice(0, 5).map((service) => service.name).filter(Boolean) ?? [];
  if (services.length) {
    return `Cuéntame qué necesitas o sobre qué servicio quieres información. Puedo orientarte con ${services.join(", ")}.`;
  }
  return "Cuéntame qué necesitas o sobre qué servicio quieres información; con eso te oriento mejor.";
}

// Respuesta cuando el usuario mencionó un servicio: valida contra los
// conocidos y da una descripción breve.
export function serviceValidationResponse(motivo: string, runtimeConfig?: RuntimePromptConfig): string {
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

// Match tolerante entre motivo mencionado y catálogo de servicios del tenant.
export function findMatchingService(
  motivo: string,
  runtimeConfig?: RuntimePromptConfig,
): RuntimePromptConfig["services"][number] | undefined {
  if (!runtimeConfig?.services?.length) return undefined;
  const lower = normalizeForSearch(motivo);
  return runtimeConfig.services.find((candidate) => {
    const haystack = normalizeForSearch(`${candidate.name} ${candidate.description} ${candidate.keywords.join(" ")}`);
    return (
      haystack.includes(lower) ||
      lower.includes(normalizeForSearch(candidate.name)) ||
      haystack.split(/\s+/).filter((word) => word.length >= 5).some((word) => lower.includes(word))
    );
  });
}

// Match directo con servicio conocido: responde con info del catálogo,
// sin invocar RAG. Migrado desde voice-agent.ts:answerKnowledgeQuestion.
export function answerKnowledgeQuestion(
  message: string,
  runtimeConfig?: RuntimePromptConfig,
): { responseText: string; serviceName?: string } | undefined {
  if (!runtimeConfig?.services.length) return undefined;

  const trimmed = message.trim();
  if (trimmed.length < 6 && !/[?¿]/.test(trimmed)) return undefined;

  const lower = normalizeForSearch(message);

  // Pregunta genérica del tipo "¿qué servicios tienen?"
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

// Aplica sustitución de placeholders en un template configurado por tenant.
export function formatTemplate(template: string, slots: ConversationSlots, timeZone?: string): string {
  return template
    .replaceAll("{nombre_cliente}", slots.nombre_cliente ?? "el cliente")
    .replaceAll("{fecha_hora}", formatDateTimeForSpeech(slots.fecha_hora, timeZone))
    .replaceAll("{motivo}", slots.motivo ?? "la solicitud");
}

// Formatea una fecha ISO para lectura en voz alta en la zona del tenant.
export function formatDateTimeForSpeech(value: string | undefined, timeZone?: string): string {
  if (!value) {
    return "la fecha y hora indicada";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timeZone || "America/Mexico_City",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// Corta a la primera oración y limita a 140 chars, ideal para voz.
export function shortenForVoice(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.split(/(?<=[.!?])\s+/)[0];
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
}

// Limita un texto arbitrario a un máximo de caracteres, cortando en
// límite de palabra si es posible. Útil para respuestas RAG largas.
export function limitVoiceText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}.`;
}
