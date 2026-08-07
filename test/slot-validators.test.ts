// Tests para slot-validators — regresiones de saneamiento de slots.
import { describe, expect, it } from "vitest";
import { sanitizeIncomingSlots } from "../src/agents/slot-validators";

describe("sanitizeIncomingSlots", () => {
  describe("P4: urgency phrases must not hallucinate fecha_hora", () => {
    it("rejects fecha_hora when message is pure 'lo antes posible'", () => {
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-08T18:00:00-06:00" },
        "Lo antes posible",
      );
      expect(result.fecha_hora).toBeUndefined();
    });

    it("rejects fecha_hora when message is 'urgente'", () => {
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-09T10:00:00-06:00" },
        "urgente",
      );
      expect(result.fecha_hora).toBeUndefined();
    });

    it("rejects fecha_hora when message is 'cuanto antes por favor'", () => {
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-10T09:00:00-06:00" },
        "cuanto antes por favor",
      );
      expect(result.fecha_hora).toBeUndefined();
    });

    it("KEEPS fecha_hora when urgency phrase includes concrete time", () => {
      // "urgente mañana en la tarde" tiene señales temporales concretas
      // → el LLM legítimamente extrajo la fecha. NO la rechazamos.
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-08T15:00:00-06:00" },
        "urgente mañana en la tarde",
      );
      expect(result.fecha_hora).toBe("2026-08-08T15:00:00-06:00");
    });

    it("KEEPS fecha_hora when message has no urgency at all", () => {
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-08T15:00:00-06:00" },
        "el viernes a las 3 pm",
      );
      expect(result.fecha_hora).toBe("2026-08-08T15:00:00-06:00");
    });

    it("KEEPS fecha_hora when urgency includes weekday", () => {
      const result = sanitizeIncomingSlots(
        { nombre_cliente: "Ana", motivo: "Redes" },
        { fecha_hora: "2026-08-08T10:00:00-06:00" },
        "urgente el viernes",
      );
      expect(result.fecha_hora).toBe("2026-08-08T10:00:00-06:00");
    });
  });
});
