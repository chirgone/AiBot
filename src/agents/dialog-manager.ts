// Dialog Manager — máquina de estados pura para conversaciones de voz.
//
// Responsabilidad: dado el estado actual, slots, intent clasificado y
// respuesta RAG inyectada, decide:
//   1. Qué texto debe decir el bot al usuario
//   2. Cuál es el siguiente estado
//   3. Qué slots faltan
//   4. Si la conversación está completa
//
// Es una FUNCIÓN PURA sin I/O: no lee de SQLite, no llama a Workers AI,
// no habla con Twilio. Todo eso vive fuera (worker, DO, agents/rag-agent).
//
// Esto la hace 100% testeable con Vitest sin mocks complejos.

import type { ConversationSlots, DialogState, RuntimePromptConfig } from "../types";
import { detectUrgency } from "./slot-extractor";
import { classifyIntent, type IntentType } from "./intent-classifier";
import {
  answerKnowledgeQuestion,
  formatTemplate,
  limitVoiceText,
  promptForSlot,
  serviceValidationResponse,
} from "./prompt-builder";
import { getMissingSlots, isFutureDateTime } from "./slot-validators";

// Respuesta RAG ya reformulada por Workers AI. Inyectada por el worker.
export interface InjectedRagAnswer {
  answer: string;
  origin: "vectorize" | "fts5" | "like";
}

export interface DialogInput {
  currentState: DialogState;
  previousSlots: ConversationSlots;
  currentSlots: ConversationSlots;
  userMessage: string;
  runtimeConfig?: RuntimePromptConfig;
  ragAnswer?: InjectedRagAnswer;
}

export interface DialogOutput {
  responseText: string;
  nextState: DialogState;
  missingSlots: (keyof ConversationSlots)[];
  isComplete: boolean;
}

// Función principal: computa la siguiente respuesta del bot.
// Migrada desde voice-agent.ts:nextTurn, sin cambios de comportamiento.
export function computeNextTurn(input: DialogInput): DialogOutput {
  const { currentState, previousSlots, currentSlots: slots, userMessage, runtimeConfig, ragAnswer } = input;

  // Clasificación de intención primero. Nos da un handle claro sobre
  // qué quiere el usuario en este turno.
  const intent = classifyIntent(userMessage, currentState);

  if (intent.type === "cancellation") {
    return {
      responseText: "Entendido, cancelo el proceso. Si necesitas algo más, vuelve a llamarnos.",
      nextState: "cancelled",
      missingSlots: [],
      isComplete: true,
    };
  }

  // Prioridad 1: RAG. Si el mensaje huele a pregunta de conocimiento y
  // el worker ya trajo respuesta, la usamos ANTES de aceptar cualquier
  // extracción de motivo que el slot-extractor haya hecho del mismo
  // mensaje. Sin esto, "cuéntame de la membresía" se aceptaría como
  // motivo=membresía y el bot saltaría a pedir fecha sin responder.
  if (ragAnswer && intent.type === "knowledge_query") {
    const missing = getMissingSlots(slots);
    const followUp = missing.length ? ` ${promptForSlot(missing[0], slots, runtimeConfig)}` : "";
    return {
      responseText: limitVoiceText(`${ragAnswer.answer}${followUp}`, 420),
      nextState: "answering_question",
      missingSlots: missing,
      isComplete: false,
    };
  }

  // Prioridad 2: match directo con un servicio conocido (rápido, sin AI).
  const knowledgeAnswer = answerKnowledgeQuestion(userMessage, runtimeConfig);
  if (knowledgeAnswer) {
    const inferredService = knowledgeAnswer.serviceName;
    const nextSlots = { ...slots, motivo: slots.motivo ?? inferredService };
    const nextPromptText = nextPromptAfterKnowledge(nextSlots, runtimeConfig);
    return {
      responseText: limitVoiceText(`${knowledgeAnswer.responseText} ${nextPromptText}`, 420),
      nextState: "collecting_info",
      missingSlots: getMissingSlots(nextSlots),
      isComplete: false,
    };
  }

  const missingSlots = getMissingSlots(slots);
  const urgencyRead = detectUrgency(userMessage);

  // Ventana de tiempo: si expresó urgencia sin especificar hora.
  if (!slots.fecha_hora && urgencyRead.needsWindow) {
    return {
      responseText: urgencyRead.urgent
        ? "Entiendo, lo marco como urgente. Para que el equipo pueda contactarte, ¿prefieres hoy en la mañana, hoy en la tarde o mañana?"
        : "Perfecto. Para agendar, ¿prefieres hoy en la mañana, hoy en la tarde o mañana?",
      nextState: "collecting_info",
      missingSlots,
      isComplete: false,
    };
  }

  // Motivo recién capturado: validar contra catálogo y pedir fecha.
  if (!previousSlots.motivo && slots.motivo && !slots.fecha_hora) {
    return {
      responseText: `${serviceValidationResponse(slots.motivo, runtimeConfig)} ${promptForSlot("fecha_hora", slots, runtimeConfig)}`,
      nextState: "collecting_info",
      missingSlots,
      isComplete: false,
    };
  }

  // Validación de fecha futura: si el extractor normalizó una fecha
  // en el pasado, no la aceptamos ni la persistimos.
  if (slots.fecha_hora && !isFutureDateTime(slots.fecha_hora)) {
    const cleanedSlots: ConversationSlots = { ...slots, fecha_hora: undefined };
    return {
      responseText: "Esa fecha ya pasó. ¿Podrías darme un día y hora a partir de hoy? Por ejemplo, mañana en la tarde.",
      nextState: "collecting_info",
      missingSlots: getMissingSlots(cleanedSlots),
      isComplete: false,
    };
  }

  // Estado 'confirming': procesar respuesta del usuario a "¿es correcto?"
  if (currentState === "confirming") {
    if (intent.type === "confirmation" && missingSlots.length === 0) {
      return {
        responseText:
          runtimeConfig?.completionMessage ??
          "Listo, quedó registrada tu solicitud. Un especialista dará seguimiento. Que tengas buen día.",
        nextState: "booked",
        missingSlots,
        isComplete: true,
      };
    }

    if (intent.type === "correction" && missingSlots.length === 0) {
      return {
        responseText: formatTemplate(
          runtimeConfig?.confirmationTemplate ??
            "Perfecto. Queda actualizado: {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
          slots,
          runtimeConfig?.timeZone,
        ),
        nextState: "confirming",
        missingSlots,
        isComplete: false,
      };
    }

    if (intent.type === "negation") {
      return {
        responseText: "Claro. Dime el dato correcto: nombre, tema, día u hora.",
        nextState: "collecting_info",
        missingSlots,
        isComplete: false,
      };
    }
  }

  // Todos los slots llenos → pasar a confirmación.
  if (missingSlots.length === 0) {
    return {
      responseText: formatTemplate(
        runtimeConfig?.confirmationTemplate ??
          "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
        slots,
        runtimeConfig?.timeZone,
      ),
      nextState: "confirming",
      missingSlots,
      isComplete: false,
    };
  }

  // Caso default: pedir el siguiente slot faltante.
  return {
    responseText: promptForSlot(missingSlots[0], slots, runtimeConfig),
    nextState: "collecting_info",
    missingSlots,
    isComplete: false,
  };
}

// Prompt después de responder una pregunta de conocimiento, para no perder
// el hilo de la captura de datos.
function nextPromptAfterKnowledge(slots: ConversationSlots, runtimeConfig?: RuntimePromptConfig): string {
  const missing = getMissingSlots(slots);
  if (!missing.length) {
    return formatTemplate(
      runtimeConfig?.confirmationTemplate ??
        "¿Quieres que registre tu solicitud para que el equipo te contacte?",
      slots,
      runtimeConfig?.timeZone,
    );
  }
  return `Para ayudarte mejor, ${promptForSlot(missing[0], slots, runtimeConfig)}`;
}

// Re-export del tipo para consumidores externos (voice-agent.ts, index.ts).
export type { IntentType };
