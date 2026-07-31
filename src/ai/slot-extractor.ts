import type { ConversationContext, ConversationSlots } from "../types";

interface SlotExtractionResponse {
  nombre_cliente: string | null;
  telefono: string | null;
  fecha_hora: string | null;
  motivo: string | null;
}

const slotSchema = {
  type: "object",
  properties: {
    nombre_cliente: {
      type: ["string", "null"],
      description: "Nombre completo o nombre de pila del paciente/cliente, si aparece.",
    },
    telefono: {
      type: ["string", "null"],
      description: "Número telefónico del cliente, si aparece explícitamente.",
    },
    fecha_hora: {
      type: ["string", "null"],
      description: "Fecha y hora normalizada en ISO 8601 con zona America/Mexico_City, si aparece.",
    },
    motivo: {
      type: ["string", "null"],
      description: "Motivo de la cita, por ejemplo limpieza dental, revisión, dolor, extracción.",
    },
  },
  required: ["nombre_cliente", "telefono", "fecha_hora", "motivo"],
};

export async function extractSlots(
  env: Env,
  userMessage: string,
  context: ConversationContext,
): Promise<Partial<ConversationSlots>> {
  if (!userMessage.trim()) {
    return {};
  }

  try {
    const result = await env.AI.run(env.AI_MODEL, {
      messages: [
        {
          role: "system",
          content: `Eres un extractor de datos para agendar citas por teléfono en México.
Hoy es ${new Date().toISOString()}.
Zona horaria operativa: ${env.TIME_ZONE}.
Reglas:
- Extrae solo datos que el usuario dijo o confirmó.
- Si el usuario dice mañana, pasado mañana, lunes, etc., normaliza a ISO 8601.
- Si el usuario dice 4 de la tarde, normaliza a 16:00.
- Si falta un dato, responde null en ese campo.
- No inventes teléfono si no aparece.
- Responde solo con JSON válido conforme al schema.`,
        },
        {
          role: "user",
          content: `Estado actual: ${context.dialogState}
Datos actuales: ${JSON.stringify(context.slots)}
Mensaje nuevo: ${userMessage}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: slotSchema,
      },
      temperature: 0.1,
      max_tokens: 256,
    });

    return normalizeSlots(parseAiResponse(result));
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "slot extraction failed; using fallback",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return fallbackExtractSlots(userMessage);
  }
}

function parseAiResponse(result: unknown): SlotExtractionResponse {
  if (isRecord(result) && "response" in result) {
    const response = result.response;
    if (typeof response === "string") {
      return coerceSlotExtractionResponse(JSON.parse(response));
    }
    if (isRecord(response)) {
      return coerceSlotExtractionResponse(response);
    }
  }

  if (typeof result === "string") {
    return coerceSlotExtractionResponse(JSON.parse(result));
  }

  if (isRecord(result)) {
    return coerceSlotExtractionResponse(result);
  }

  throw new Error("Unexpected Workers AI response shape");
}

function coerceSlotExtractionResponse(value: unknown): SlotExtractionResponse {
  if (!isRecord(value)) {
    throw new Error("Workers AI response is not an object");
  }

  return {
    nombre_cliente: getNullableString(value, "nombre_cliente"),
    telefono: getNullableString(value, "telefono"),
    fecha_hora: getNullableString(value, "fecha_hora"),
    motivo: getNullableString(value, "motivo"),
  };
}

function getNullableString(value: Record<string, unknown>, key: keyof SlotExtractionResponse): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function normalizeSlots(slots: SlotExtractionResponse): Partial<ConversationSlots> {
  return {
    nombre_cliente: clean(slots.nombre_cliente),
    telefono: clean(slots.telefono),
    fecha_hora: clean(slots.fecha_hora),
    motivo: clean(slots.motivo),
  };
}

function fallbackExtractSlots(message: string): Partial<ConversationSlots> {
  const lower = message.toLowerCase();
  const slots: Partial<ConversationSlots> = {};

  const nameMatch = lower.match(/(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñü\s]{2,40})/i);
  if (nameMatch?.[1]) {
    slots.nombre_cliente = titleCase(nameMatch[1].trim());
  }

  const phoneMatch = message.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch?.[0]) {
    slots.telefono = phoneMatch[0].replace(/\s+/g, " ").trim();
  }

  if (lower.includes("limpieza")) {
    slots.motivo = "limpieza dental";
  } else if (lower.includes("revisión") || lower.includes("revision")) {
    slots.motivo = "revisión dental";
  } else if (lower.includes("dolor")) {
    slots.motivo = "dolor dental";
  }

  return slots;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
