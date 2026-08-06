import type { ConversationContext, ConversationSlots, RuntimePromptConfig } from "../types";

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
      description: "Nombre completo o nombre de pila del cliente o contacto, si aparece.",
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
      description: "Tema de la solicitud o asesoría, por ejemplo Cómputo y DaaS, Servidores y Nube OnPremise, Redes, Ciberseguridad y Videovigilancia, SOC & NOC as a Service, Videocolaboración y Automatización de Espacios o Arrendamiento Tecnológico.",
    },
  },
  required: ["nombre_cliente", "telefono", "fecha_hora", "motivo"],
};

export async function extractSlots(
  env: Env,
  userMessage: string,
  context: ConversationContext,
  runtimeConfig?: RuntimePromptConfig,
): Promise<Partial<ConversationSlots>> {
  if (!userMessage.trim()) {
    return {};
  }

  try {
    const result = await env.AI.run(env.AI_MODEL, {
      messages: [
        {
          role: "system",
          content: `Eres un extractor de datos para registrar solicitudes de asesoría por teléfono en México para ${runtimeConfig?.businessName ?? "Alta Sistemas"}.
Contexto del negocio: ${runtimeConfig?.knowledgeSummary ?? "Alta Sistemas ofrece una propuesta integral de tecnología para negocios mexicanos: Servicios Administrados de Cómputo y Device as a Service, Servidores y Nube OnPremise, Data Center, Almacenamiento y Virtualización, Redes, Ciberseguridad y Videovigilancia, SOC & NOC as a Service, Videocolaboración y Automatización de Espacios, y Arrendamiento Tecnológico Empresarial."}
Servicios conocidos: ${runtimeConfig?.services.map((service) => `${service.name}: ${service.description}`).join(" | ") ?? "Cómputo y DaaS, Servidores y Nube OnPremise, Redes, Ciberseguridad y Videovigilancia, SOC & NOC as a Service, Videocolaboración y Automatización, Arrendamiento Tecnológico"}.
Hoy es ${new Date().toISOString()}.
Zona horaria operativa: ${runtimeConfig?.timeZone ?? env.TIME_ZONE}.
Reglas:
- Extrae solo datos que el usuario dijo o confirmó.
- Si el usuario dice mañana, pasado mañana, lunes, etc., normaliza a ISO 8601.
- Si el usuario dice 4 de la tarde, normaliza a 16:00.
- Si el usuario solo dice un día sin hora, responde null en fecha_hora.
- Si falta un dato, responde null en ese campo.
- No inventes teléfono si no aparece.
- No uses nombres de personas como motivo. Si el mensaje solo parece un nombre, motivo debe ser null.
- El motivo debe ser un servicio, área, problema o necesidad de negocio, no el nombre del cliente.
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

    return withHeuristics(userMessage, context, normalizeSlots(parseAiResponse(result)));
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "slot extraction failed; using fallback",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return withHeuristics(userMessage, context, fallbackExtractSlots(userMessage));
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
  const normalized = {
    nombre_cliente: clean(slots.nombre_cliente),
    telefono: clean(slots.telefono),
    fecha_hora: clean(slots.fecha_hora),
    motivo: clean(slots.motivo),
  };
  if (normalized.nombre_cliente && normalized.motivo && sameNormalizedText(normalized.nombre_cliente, normalized.motivo)) {
    normalized.motivo = undefined;
  }
  return normalized;
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

  slots.motivo = inferReason(lower);

  return slots;
}

function withHeuristics(
  message: string,
  context: ConversationContext,
  slots: Partial<ConversationSlots>,
): Partial<ConversationSlots> {
  const enriched = { ...slots };
  const lower = message.toLowerCase().trim();

  if (!context.slots.nombre_cliente && !enriched.nombre_cliente) {
    const possibleName = inferName(message);
    if (possibleName) {
      enriched.nombre_cliente = possibleName;
    }
  }

  const deterministicDateTime = inferRelativeDateTime(lower);
  if (deterministicDateTime && (!context.slots.fecha_hora || isCorrection(lower) || context.dialogState === "confirming")) {
    enriched.fecha_hora = deterministicDateTime;
  }

  if (!context.slots.motivo && !enriched.motivo) {
    const possibleReason = inferReason(lower);
    if (possibleReason) {
      enriched.motivo = possibleReason;
    }
  }

  if (context.slots.motivo && needsTimeWindow(lower)) {
    enriched.motivo = undefined;
  }

  return enriched;
}

function isCorrection(lower: string): boolean {
  return /\b(no|cambia|cambiar|corrige|corregir|mejor|otra hora|otro dia|otro día|seria|sería)\b/.test(lower);
}

// Frases que fuerzan al bot a preguntar la ventana (mañana/tarde/noche) porque
// el usuario no dio una hora exacta. NO todas implican urgencia real.
function needsTimeWindow(lower: string): boolean {
  return URGENT_STRICT_REGEX.test(lower) || URGENT_LOOSE_REGEX.test(lower);
}

// Urgencia real: lo persistimos como leads.urgent = 1.
const URGENT_STRICT_REGEX =
  /\b(lo antes posible|cuanto antes|urgente|urge|urg[ée]ncia|emergencia|hoy mismo|inmediato|inmediata|de inmediato|ya mismo|ahora mismo)\b/i;

// Vagas — piden ventana pero no marcan urgencia.
const URGENT_LOOSE_REGEX =
  /\b(en cuanto puedan|en cuanto sea posible|lo m[aá]s pronto|pronto|cuando puedan)\b/i;

export function detectUrgency(message: string): { urgent: boolean; phrase?: string; needsWindow: boolean } {
  const strict = message.match(URGENT_STRICT_REGEX);
  if (strict) {
    return { urgent: true, phrase: strict[0].toLowerCase(), needsWindow: true };
  }
  const loose = message.match(URGENT_LOOSE_REGEX);
  if (loose) {
    return { urgent: false, phrase: loose[0].toLowerCase(), needsWindow: true };
  }
  return { urgent: false, needsWindow: false };
}

function inferName(message: string): string | undefined {
  const cleanMessage = message
    .replace(/[.,!?¿¡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = cleanMessage.toLowerCase();

  if (
    !cleanMessage ||
    lower.length < 2 ||
    lower.length > 40 ||
    /\d/.test(lower) ||
    /\b(mañana|pasado|hoy|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|infraestructura|ciberseguridad|seguridad|redes|wifi|lan|cctv|videovigilancia|data|center|nube|onpremise|almacenamiento|virtualización|virtualizacion|servidores|soc|noc|soporte|mantenimiento|cómputo|computo|daas|device|videocolaboración|videocolaboracion|audioconferencia|automatización|automatizacion|arrendamiento|leasing|financiamiento|ataque|ransomware|cita|consulta|asesoría|asesoria|hora|tarde|mañana)\b/.test(
      lower,
    )
  ) {
    return undefined;
  }

  const nameMatch = lower.match(/(?:me llamo|soy|mi nombre es)\s+(.+)/i);
  const rawName = nameMatch?.[1] ?? cleanMessage;
  const words = rawName.split(/\s+/).filter(Boolean);
  if (words.length > 4) {
    return undefined;
  }

  return titleCase(words.join(" "));
}

function inferReason(lower: string): string | undefined {
  if (lower.includes("ransomware") || lower.includes("ataque") || lower.includes("incidente")) return "respuesta inmediata y ciberseguridad con monitoreo 24/7";
  if (lower.includes("soc") || lower.includes("monitoreo de seguridad")) return "SOC como servicio y monitoreo de seguridad 24/7";
  if (lower.includes("noc") || lower.includes("monitoreo de red")) return "NOC como servicio para monitoreo de infraestructura";
  if (lower.includes("ciberseguridad") || lower.includes("seguridad") || lower.includes("firewall")) return "redes, ciberseguridad y videovigilancia";
  if (lower.includes("wifi") || lower.includes("lan") || lower.includes("redes") || lower.includes("cctv") || lower.includes("videovigilancia")) return "redes empresariales, ciberseguridad y videovigilancia";
  if (lower.includes("data center") || lower.includes("datacenter") || lower.includes("nube privada") || lower.includes("onpremise") || lower.includes("on premise")) return "data centers y nube privada OnPremise";
  if (lower.includes("almacenamiento") || lower.includes("virtualización") || lower.includes("virtualizacion")) return "almacenamiento y virtualización";
  if (lower.includes("servidor") || lower.includes("servidores")) return "servidores y nube privada";
  if (lower.includes("infraestructura") || lower.includes("daas") || lower.includes("device") || lower.includes("cómputo") || lower.includes("computo") || lower.includes("laptops") || lower.includes("equipos")) return "servicios administrados de cómputo y DaaS";
  if (lower.includes("soporte") || lower.includes("mantenimiento")) return "soporte y mantenimiento TI";
  if (lower.includes("videocolaboración") || lower.includes("videocolaboracion") || lower.includes("audioconferencia") || lower.includes("salas") || lower.includes("automatización") || lower.includes("automatizacion")) return "videocolaboración y automatización de espacios";
  if (lower.includes("arrendamiento") || lower.includes("leasing") || lower.includes("financiamiento")) return "arrendamiento tecnológico con planes flexibles";
  if (lower.includes("pantallas") || lower.includes("digital signage")) return "pantallas digitales";

  return undefined;
}

function sameNormalizedText(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function inferRelativeDateTime(lower: string): string | undefined {
  if (!/\b(hoy|mañana|pasado mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/.test(lower)) {
    return undefined;
  }

  const today = getMexicoCityToday();
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0));
  const weekdayIndex = parseWeekday(lower);

  if (lower.includes("pasado mañana")) {
    target.setUTCDate(target.getUTCDate() + 2);
  } else if (lower.includes("mañana")) {
    target.setUTCDate(target.getUTCDate() + 1);
  } else if (weekdayIndex !== undefined) {
    const currentWeekday = target.getUTCDay();
    const daysAhead = (weekdayIndex - currentWeekday + 7) % 7 || 7;
    target.setUTCDate(target.getUTCDate() + daysAhead);
  }

  const time = parseSpokenTime(lower) ?? parseTimeWindow(lower);
  if (!time) {
    return undefined;
  }

  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T${pad(time.hour)}:${pad(time.minute)}:00-06:00`;
}

function parseTimeWindow(lower: string): { hour: number; minute: number } | undefined {
  if (/\bmañana\b/.test(lower) && !lower.includes("pasado mañana")) return { hour: 10, minute: 0 };
  if (/\btarde\b/.test(lower)) return { hour: 16, minute: 0 };
  if (/\bnoche\b/.test(lower)) return { hour: 18, minute: 0 };
  return undefined;
}

function getMexicoCityToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) {
    throw new Error("Could not resolve Mexico City date");
  }

  return { year, month, day };
}

function parseWeekday(lower: string): number | undefined {
  if (lower.includes("domingo")) return 0;
  if (lower.includes("lunes")) return 1;
  if (lower.includes("martes")) return 2;
  if (lower.includes("miércoles") || lower.includes("miercoles")) return 3;
  if (lower.includes("jueves")) return 4;
  if (lower.includes("viernes")) return 5;
  if (lower.includes("sábado") || lower.includes("sabado")) return 6;
  return undefined;
}

function parseSpokenTime(lower: string): { hour: number; minute: number } | undefined {
  const digitMatch = lower.match(/(?:a las|alas|a la|la)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|de la mañana|de la tarde|de la noche|mañana|tarde|noche)?/);
  const wordHour = parseHourWord(lower);

  const hourValue = digitMatch?.[1] ? Number(digitMatch[1]) : wordHour;
  if (!hourValue || hourValue > 23) {
    return undefined;
  }

  const suffix = digitMatch?.[3] ?? parseTimeSuffix(lower) ?? "";
  let hour = hourValue;
  if ((suffix.includes("tarde") || suffix.includes("noche") || suffix === "pm") && hour < 12) {
    hour += 12;
  }
  if ((suffix.includes("mañana") || suffix === "am") && hour === 12) {
    hour = 0;
  }

  return {
    hour,
    minute: digitMatch?.[2] ? Number(digitMatch[2]) : 0,
  };
}

function parseTimeSuffix(lower: string): string | undefined {
  if (/\b(pm|de la tarde|tarde)\b/.test(lower)) return "tarde";
  if (/\b(de la noche|noche)\b/.test(lower)) return "noche";
  if (/\b(am|de la mañana)\b/.test(lower)) return "mañana";
  return undefined;
}

function parseHourWord(lower: string): number | undefined {
  const hours: Record<string, number> = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  };

  for (const [word, hour] of Object.entries(hours)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      return hour;
    }
  }

  return undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
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
