import type { TwilioVoiceRequest } from "../types";

const MAX_FORM_BYTES = 32_768;

export async function readVerifiedTwilioBody(request: Request, env: Env): Promise<string> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FORM_BYTES) {
    throw new Error("Twilio webhook body too large");
  }

  const body = await request.text();
  if (body.length > MAX_FORM_BYTES) {
    throw new Error("Twilio webhook body too large");
  }

  const secrets = getRuntimeSecrets(env);
  if (secrets.SKIP_SIGNATURE_VALIDATION === "true") {
    return body;
  }

  if (!secrets.TWILIO_AUTH_TOKEN) {
    throw new Error("Missing TWILIO_AUTH_TOKEN secret");
  }

  const valid = await verifyTwilioSignature(request, body, secrets.TWILIO_AUTH_TOKEN);
  if (!valid) {
    throw new Error("Invalid Twilio signature");
  }

  return body;
}

export function parseTwilioVoiceBody(body: string): TwilioVoiceRequest {
  const params = new URLSearchParams(body);
  const callSid = params.get("CallSid") || `call_${crypto.randomUUID()}`;
  const rawConfidence = params.get("Confidence");
  const parsedConfidence = rawConfidence !== null ? Number.parseFloat(rawConfidence) : Number.NaN;

  return {
    callSid,
    from: normalizePhone(params.get("From") ?? "unknown"),
    to: normalizePhone(params.get("To") ?? "unknown"),
    speechResult: params.get("SpeechResult")?.trim() ?? "",
    confidence: Number.isFinite(parsedConfidence) ? parsedConfidence : undefined,
    digits: params.get("Digits") ?? undefined,
  };
}

// URLSearchParams decodifica el `+` como espacio (application/x-www-form-urlencoded
// espec.). Twilio manda el n\u00famero como `+18454090168`; si el cliente o
// proxy no escap\u00f3 el `+` como `%2B`, llega como ` 18454090168`.
// Normalizamos: quitamos espacios y anteponemos `+` si el string es
// s\u00f3lo d\u00edgitos (E.164 always starts con +).
function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "unknown") return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d{7,}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

async function verifyTwilioSignature(
  request: Request,
  rawBody: string,
  authToken: string,
): Promise<boolean> {
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    return false;
  }

  const url = new URL(request.url);
  const candidateUrls = new Set<string>([
    request.url,
    `${url.protocol}//${url.host}${url.pathname}`,
    `https://${url.host}${url.pathname}`,
    `http://${url.host}${url.pathname}`,
  ]);

  const expectedSignatures = await Promise.all(
    Array.from(candidateUrls).map((candidateUrl) => signTwilioPayload(candidateUrl, rawBody, authToken)),
  );

  for (const expected of expectedSignatures) {
    if (await timingSafeEqual(signature, expected)) {
      return true;
    }
  }

  return false;
}

async function signTwilioPayload(url: string, rawBody: string, authToken: string): Promise<string> {
  const params = new URLSearchParams(rawBody);
  const payload = Array.from(params.keys())
    .sort()
    .reduce((acc, key) => `${acc}${key}${params.get(key) ?? ""}`, url);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);

  return constantTimeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function getRuntimeSecrets(env: Env): {
  TWILIO_AUTH_TOKEN?: string;
  SKIP_SIGNATURE_VALIDATION?: string;
} {
  const runtimeEnv = env as Env & {
    TWILIO_AUTH_TOKEN?: string;
    SKIP_SIGNATURE_VALIDATION?: string;
  };

  return {
    TWILIO_AUTH_TOKEN: runtimeEnv.TWILIO_AUTH_TOKEN,
    SKIP_SIGNATURE_VALIDATION: runtimeEnv.SKIP_SIGNATURE_VALIDATION,
  };
}
