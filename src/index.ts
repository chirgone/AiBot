import { extractSlots } from "./ai/slot-extractor";
import { VoiceAgent } from "./durable-objects/voice-agent";
import { renderHelpPage } from "./help-page";
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
          "Lo siento, ocurrió un problema técnico. Por favor intenta de nuevo más tarde o comunícate con Alta Sistemas por otro canal.",
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

  return twimlGather({
    action: "/webhook/voice/process",
    message: `Gracias por llamar a ${env.BUSINESS_NAME}, soluciones tecnológicas inteligentes para la operación de negocios mexicanos. Soy ${env.ASSISTANT_NAME}. Te ayudo a canalizar tu solicitud con un especialista. Para empezar, ¿me regalas tu nombre?`,
    language: env.LANGUAGE,
    voice: env.VOICE,
  });
}

async function handleVoiceTurn(request: Request, env: Env): Promise<Response> {
  const body = await readVerifiedTwilioBody(request, env);
  const voiceRequest = parseTwilioVoiceBody(body);
  const stub = env.VOICE_AGENT.getByName(voiceRequest.callSid);
  await stub.initConversation(voiceRequest.callSid, voiceRequest.from);

  const userMessage = voiceRequest.speechResult || voiceRequest.digits || "";
  if (!userMessage) {
    const context = await stub.getConversationContext(voiceRequest.callSid);
    return twimlGather({
      action: "/webhook/voice/process",
      message: retryPrompt(context.dialogState),
      language: env.LANGUAGE,
      voice: env.VOICE,
    });
  }

  const context = await stub.getConversationContext(voiceRequest.callSid);
  const slots = await extractSlots(env, userMessage, context);
  const result = await stub.processTurn(voiceRequest.callSid, userMessage, slots);

  if (result.isComplete) {
    return twimlSayAndHangup(result.responseText, env.LANGUAGE, env.VOICE);
  }

  return twimlGather({
    action: "/webhook/voice/process",
    message: result.responseText,
    language: env.LANGUAGE,
    voice: env.VOICE,
  });
}

function retryPrompt(dialogState: string): string {
  if (dialogState === "confirming") {
    return "Perdón, no te escuché bien. Solo dime sí para confirmar la solicitud, o no para corregir.";
  }

  return "Perdón, no te escuché bien. ¿Me lo repites un poco más despacio?";
}
