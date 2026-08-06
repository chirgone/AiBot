export interface GatherOptions {
  action: string;
  message: string;
  language: string;
  voice: string;
  hints?: string[];
  speechTimeout?: string;
  timeout?: string;
}

export function twimlGather(options: GatherOptions): Response {
  const speechTimeout = sanitizeSpeechTimeout(options.speechTimeout);
  const timeout = sanitizeTimeout(options.timeout);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(options.action)}" method="POST" language="${escapeXml(options.language)}" speechTimeout="${escapeXml(speechTimeout)}" timeout="${escapeXml(timeout)}" actionOnEmptyResult="true" hints="${escapeXml((options.hints ?? defaultHints).join(","))}">
    <Say voice="${escapeXml(options.voice)}" language="${escapeXml(options.language)}">${escapeXml(shortenForTwilio(options.message))}</Say>
  </Gather>
  <Redirect method="POST">${escapeXml(options.action)}</Redirect>
</Response>`;

  return twimlResponse(body);
}

// Twilio acepta "auto" o un entero >= 1. Cualquier otra cosa la rechaza.
function sanitizeSpeechTimeout(value: string | undefined): string {
  if (!value) return "1";
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "auto") return "auto";
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(num) || num < 1 || num > 30) return "1";
  return String(num);
}

// timeout de Gather: entero 1-600. Fallback 4s.
function sanitizeTimeout(value: string | undefined): string {
  if (!value) return "4";
  const num = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(num) || num < 1 || num > 600) return "4";
  return String(num);
}

const defaultHints = [
  "asesoría",
  "propuesta integral",
  "soluciones tecnológicas",
  "cómputo",
  "DaaS",
  "servidores",
  "nube OnPremise",
  "redes",
  "ciberseguridad",
  "SOC",
  "NOC",
  "videocolaboración",
  "arrendamiento tecnológico",
  "mañana",
  "pasado mañana",
  "tarde",
  "nombre",
  "hora",
];

export function twimlSayAndHangup(message: string, language: string, voice: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(voice)}" language="${escapeXml(language)}">${escapeXml(shortenForTwilio(message))}</Say>
  <Hangup />
</Response>`;

  return twimlResponse(body);
}

function twimlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shortenForTwilio(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= 420) return clean;
  return `${clean.slice(0, 400).replace(/\s+\S*$/, "")}.`;
}
