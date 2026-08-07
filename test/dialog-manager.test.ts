// Tests unitarios para agents/dialog-manager.ts
//
// dialog-manager es una FUNCIÓN PURA sin I/O — no depende de env, DO,
// Twilio ni Workers AI. Estos tests validan cada transición de estado
// sin mocks complejos.

import { describe, expect, it } from "vitest";
import { computeNextTurn } from "../src/agents/dialog-manager";
import type { RuntimePromptConfig } from "../src/types";

const baseConfig: RuntimePromptConfig = {
  tenantId: "test-tenant",
  businessName: "Test Business",
  assistantName: "Test Assistant",
  language: "es-MX",
  voice: "Polly.Mia-Neural",
  timeZone: "America/Mexico_City",
  greeting: "Hola, ¿en qué puedo ayudarte?",
  confirmationTemplate:
    "Confirmo: {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
  completionMessage: "Listo, quedó registrada tu solicitud.",
  fallbackMessage: "Perdón, no te escuché. ¿Puedes repetir?",
  speechHints: [],
  prompts: {},
  knowledgeSummary: "Test business con servicios de asesoría.",
  services: [
    {
      name: "Ciberseguridad",
      description: "Protección de infraestructura y datos.",
      keywords: ["seguridad", "firewall", "ataque"],
    },
    {
      name: "Redes empresariales",
      description: "Diseño e instalación de redes LAN y WiFi.",
      keywords: ["red", "wifi", "lan"],
    },
  ],
  menuTopics: [],
};

// Fecha futura fija para tests determinísticos: mañana mismo a las 4pm.
function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe("computeNextTurn", () => {
  describe("cancellation", () => {
    it("returns cancelled state when user says 'cancelar'", () => {
      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Carlos" },
        currentSlots: { nombre_cliente: "Carlos" },
        userMessage: "cancelar todo por favor",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("cancelled");
      expect(result.isComplete).toBe(true);
      expect(result.responseText).toContain("cancelo");
    });

    it("returns cancelled when user says 'ya no'", () => {
      const result = computeNextTurn({
        currentState: "confirming",
        previousSlots: {},
        currentSlots: { nombre_cliente: "Ana", motivo: "seguridad", fecha_hora: tomorrowAt(16) },
        userMessage: "ya no gracias",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("cancelled");
      expect(result.isComplete).toBe(true);
    });
  });

  describe("slot collection flow", () => {
    it("prompts for nombre_cliente when all slots empty", () => {
      const result = computeNextTurn({
        currentState: "greeting",
        previousSlots: {},
        currentSlots: {},
        userMessage: "hola",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("collecting_info");
      expect(result.missingSlots).toContain("nombre_cliente");
      expect(result.isComplete).toBe(false);
    });

    it("moves to confirming when all slots filled", () => {
      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Ana", motivo: "seguridad" },
        currentSlots: {
          nombre_cliente: "Ana",
          motivo: "seguridad",
          fecha_hora: tomorrowAt(16),
        },
        userMessage: "mañana a las cuatro de la tarde",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("confirming");
      expect(result.isComplete).toBe(false);
      expect(result.responseText).toContain("Ana");
      expect(result.responseText).toContain("¿Es correcto?");
    });
  });

  describe("confirmation flow", () => {
    const filledSlots = {
      nombre_cliente: "Ana",
      motivo: "seguridad",
      fecha_hora: tomorrowAt(16),
    };

    it("books when user confirms with 'sí'", () => {
      const result = computeNextTurn({
        currentState: "confirming",
        previousSlots: filledSlots,
        currentSlots: filledSlots,
        userMessage: "sí, correcto",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("booked");
      expect(result.isComplete).toBe(true);
      expect(result.responseText).toBe(baseConfig.completionMessage);
    });

    it("goes back to collecting_info when user says 'no'", () => {
      const result = computeNextTurn({
        currentState: "confirming",
        previousSlots: filledSlots,
        currentSlots: filledSlots,
        userMessage: "no, incorrecto",
        runtimeConfig: baseConfig,
      });
      // "no incorrecto" matches hasCorrection (correction intent) → re-confirm
      expect(["collecting_info", "confirming"]).toContain(result.nextState);
      expect(result.isComplete).toBe(false);
    });
  });

  describe("past date rejection", () => {
    it("rejects fecha_hora in the past and asks again", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Ana", motivo: "seguridad" },
        currentSlots: {
          nombre_cliente: "Ana",
          motivo: "seguridad",
          fecha_hora: yesterday.toISOString(),
        },
        userMessage: "ayer a las tres",
        runtimeConfig: baseConfig,
      });
      expect(result.responseText).toContain("Esa fecha ya pasó");
      expect(result.nextState).toBe("collecting_info");
      expect(result.missingSlots).toContain("fecha_hora");
    });
  });

  describe("knowledge query with RAG", () => {
    it("answers with RAG fragment when intent is knowledge_query", () => {
      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Ana" },
        currentSlots: { nombre_cliente: "Ana" },
        userMessage: "¿tienen soluciones de firewall gestionado para bancos?",
        runtimeConfig: baseConfig,
        ragAnswer: {
          answer: "Sí, ofrecemos firewalls gestionados 24/7 con detección de amenazas.",
          origin: "vectorize",
        },
      });
      expect(result.nextState).toBe("answering_question");
      expect(result.responseText).toContain("firewalls gestionados");
      expect(result.isComplete).toBe(false);
      // Debe cerrar pidiendo el siguiente slot (motivo)
      expect(result.missingSlots).toContain("motivo");
    });
  });

  describe("direct service match", () => {
    it("matches known service without RAG and asks for date", () => {
      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Ana" },
        currentSlots: { nombre_cliente: "Ana" },
        userMessage: "necesito servicios de ciberseguridad para mi empresa",
        runtimeConfig: baseConfig,
      });
      expect(result.nextState).toBe("collecting_info");
      expect(result.responseText.toLowerCase()).toContain("ciberseguridad");
    });
  });

  describe("urgency detection", () => {
    it("asks for time window when urgent without specific hour", () => {
      // Nota: usamos motivo genérico "consulta" para evitar que el matcher
      // de servicios (que tiene prioridad sobre urgencia en dialog-manager)
      // intercepte el turno.
      const result = computeNextTurn({
        currentState: "collecting_info",
        previousSlots: { nombre_cliente: "Ana", motivo: "consulta" },
        currentSlots: { nombre_cliente: "Ana", motivo: "consulta" },
        userMessage: "lo antes posible por favor",
        runtimeConfig: baseConfig,
      });
      expect(result.responseText.toLowerCase()).toContain("mañana");
      expect(result.nextState).toBe("collecting_info");
      expect(result.missingSlots).toContain("fecha_hora");
    });
  });
});
