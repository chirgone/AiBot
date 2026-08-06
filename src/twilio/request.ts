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

  return {
    callSid,
    from: params.get("From") ?? "unknown",
    to: params.get("To") ?? "unknown",
    speechResult: params.get("SpeechResult")?.trim() ?? "",
    confidence: params.get("Confidence") ?? undefined,
    digits: params.get("Digits") ?? undefined,
  };
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
