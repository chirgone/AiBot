import { extractSlots } from "./ai/slot-extractor";
import { handleAdminApi, requireAdmin } from "./admin-api";
import { renderAccessRequiredPage, renderAdminPage } from "./admin-page";
import { VoiceAgent } from "./durable-objects/voice-agent";
import { renderHelpPage } from "./help-page";
import { recordConfirmedLead, resolveRuntimeConfig } from "./runtime-config";
import { parseTwilioVoiceBody, readVerifiedTwilioBody } from "./twilio/request";
import { twimlGather, twimlSayAndHangup } from "./twilio/twiml";

export { VoiceAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "agentica-voice" });
      }

      if ((request.method === "GET" || request.method === "HEAD") && (url.hostname === "help.angaflow.mx" || url.pathname === "/docs")) {
        return renderHelpPage();
      }

      if (url.hostname === "admin.angaflow.mx" || url.pathname.startsWith("/api/admin")) {
        const admin = requireAdmin(request);
        if (admin instanceof Response) {
          return url.pathname.startsWith("/api/admin") ? admin : renderAccessRequiredPage();
        }

        if (url.pathname.startsWith("/api/admin")) {
          return await handleAdminApi(request, env, admin);
        }

        if (request.method === "GET" || request.method === "HEAD") {
          return renderAdminPage(admin.email);
        }
      }

      if (request.method === "POST" && url.pathname === "/webhook/voice") {
        return await handleIncomingCall(request, env);
      }

      if (request.method === "POST" && url.pathname === "/webhook/voice/process") {
        return await handleVoiceTurn(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      if (url.pathname.startsWith("/webhook/voice")) {
        return twimlSayAndHangup(
          "Lo siento, ocurrió un problema técnico. Por favor intenta de nuevo más tarde o comunícate por otro canal.",
          env.LANGUAGE,
          env.VOICE,
        );
      }

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleIncomingCall(request: Request, env: Env): Promise<Response> {
  const body = await readVerifiedTwilioBody(request, env);
  const voiceRequest = parseTwilioVoiceBody(body);
  const stub = env.VOICE_AGENT.getByName(voiceRequest.callSid);

  await stub.initConversation(voiceRequest.callSid, voiceRequest.from);
  const runtimeConfig = await resolveRuntimeConfig(env, voiceRequest.to);

  return twimlGather({
    action: "/webhook/voice/process",
    message: withInitialQuestion(runtimeConfig.greeting, runtimeConfig.prompts.nombre_cliente),
    language: runtimeConfig.language,
    voice: runtimeConfig.voice,
    hints: runtimeConfig.speechHints,
  });
}

async function handleVoiceTurn(request: Request, env: Env): Promise<Response> {
  const body = await readVerifiedTwilioBody(request, env);
  const voiceRequest = parseTwilioVoiceBody(body);
  const stub = env.VOICE_AGENT.getByName(voiceRequest.callSid);
  await stub.initConversation(voiceRequest.callSid, voiceRequest.from);
  const runtimeConfig = await resolveRuntimeConfig(env, voiceRequest.to);

  const userMessage = voiceRequest.speechResult || voiceRequest.digits || "";
  if (!userMessage) {
    const context = await stub.getConversationContext(voiceRequest.callSid);
    return twimlGather({
      action: "/webhook/voice/process",
      message: retryPrompt(context.dialogState, runtimeConfig.fallbackMessage),
      language: runtimeConfig.language,
      voice: runtimeConfig.voice,
      hints: runtimeConfig.speechHints,
    });
  }

  const context = await stub.getConversationContext(voiceRequest.callSid);
  const slots = await extractSlots(env, userMessage, context, runtimeConfig);
  const result = await stub.processTurn(voiceRequest.callSid, userMessage, slots, runtimeConfig);
  console.log(
    JSON.stringify({
      message: "voice turn",
      callSid: voiceRequest.callSid,
      state: result.dialogState,
      complete: result.isComplete,
      responseLength: result.responseText.length,
      missingSlots: result.missingSlots,
    }),
  );

  if (result.isComplete) {
    if (result.dialogState === "booked" && result.slots) {
      await recordConfirmedLead(env, runtimeConfig, voiceRequest.callSid, voiceRequest.from, result.slots);
    }

    return twimlSayAndHangup(result.responseText, runtimeConfig.language, runtimeConfig.voice);
  }

  return twimlGather({
    action: "/webhook/voice/process",
    message: result.responseText,
    language: runtimeConfig.language,
    voice: runtimeConfig.voice,
    hints: runtimeConfig.speechHints,
  });
}

function withInitialQuestion(greeting: string, namePrompt?: string): string {
  if (/\bnombre\b/i.test(greeting)) return greeting;
  return `${greeting} ${namePrompt || "¿Me compartes tu nombre?"}`;
}

function retryPrompt(dialogState: string, fallbackMessage: string): string {
  if (dialogState === "confirming") {
    return "Perdón, no te escuché bien. Solo dime sí para confirmar la solicitud, o no para corregir.";
  }

  return fallbackMessage;
}
