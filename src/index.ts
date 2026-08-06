import { extractSlots } from "./ai/slot-extractor";
import { answerFromContext, searchKnowledgeContext } from "./ai/rag";
import { handleAdminApi, requireAdmin } from "./admin-api";
import { renderAccessRequiredPage, renderAdminPage } from "./admin-page";
import { VoiceAgent } from "./durable-objects/voice-agent";
import { renderHelpPage } from "./help-page";
import { recordConfirmedLead, resolveRuntimeConfig } from "./runtime-config";
import { parseTwilioVoiceBody, readVerifiedTwilioBody } from "./twilio/request";
import { twimlGather, twimlSayAndHangup } from "./twilio/twiml";
import type { InjectedRagAnswer } from "./durable-objects/voice-agent";
import type { RuntimePromptConfig } from "./types";

export { VoiceAgent };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
          return await handleAdminApi(request, env, admin, ctx);
        }

        if (request.method === "GET" || request.method === "HEAD") {
          return renderAdminPage(admin.email);
        }
      }

      if (request.method === "POST" && url.pathname === "/webhook/voice") {
        return await handleIncomingCall(request, env);
      }

      if (request.method === "POST" && url.pathname === "/webhook/voice/process") {
        return await handleVoiceTurn(request, env, ctx);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          path: url.pathname,
          method: request.method,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );

      if (url.pathname.startsWith("/webhook/voice")) {
        return twimlSayAndHangup(
          "Lo siento, ocurrió un problema técnico. Por favor intenta de nuevo más tarde o comunícate por otro canal.",
          env.LANGUAGE,
          env.VOICE,
        );
      }

      return Response.json({
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
        path: url.pathname,
      }, { status: 500 });
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
    speechTimeout: runtimeConfig.speechTimeout,
    timeout: runtimeConfig.timeout,
  });
}

async function handleVoiceTurn(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readVerifiedTwilioBody(request, env);
  const voiceRequest = parseTwilioVoiceBody(body);
  const stub = env.VOICE_AGENT.getByName(voiceRequest.callSid);
  await stub.initConversation(voiceRequest.callSid, voiceRequest.from);
  const runtimeConfig = await resolveRuntimeConfig(env, voiceRequest.to);

  const minConfidence = Number.parseFloat(env.MIN_SPEECH_CONFIDENCE ?? "0.4");
  const confidenceFloor = Number.isFinite(minConfidence) ? minConfidence : 0.4;
  const maxTurns = Number.parseInt(env.MAX_TURNS_PER_CALL ?? "12", 10);
  const turnLimit = Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 12;

  const userMessage = voiceRequest.speechResult || voiceRequest.digits || "";
  const lowConfidenceSpeech =
    voiceRequest.speechResult.length > 0 &&
    typeof voiceRequest.confidence === "number" &&
    voiceRequest.confidence < confidenceFloor;

  if (!userMessage || lowConfidenceSpeech) {
    const context = await stub.getConversationContext(voiceRequest.callSid);
    const reason = lowConfidenceSpeech ? "low_confidence" : "empty_speech";
    console.log(
      JSON.stringify({
        message: "voice turn: reprompt",
        callSid: voiceRequest.callSid,
        reason,
        confidence: voiceRequest.confidence ?? null,
      }),
    );
    const promptMessage = lowConfidenceSpeech
      ? "Perdón, no te escuché bien. ¿Me lo puedes repetir un poco más despacio?"
      : retryPrompt(context.dialogState, runtimeConfig.fallbackMessage);
    return twimlGather({
      action: "/webhook/voice/process",
      message: promptMessage,
      language: runtimeConfig.language,
      voice: runtimeConfig.voice,
      hints: runtimeConfig.speechHints,
      speechTimeout: runtimeConfig.speechTimeout,
      timeout: runtimeConfig.timeout,
    });
  }

  const context = await stub.getConversationContext(voiceRequest.callSid);

  // Paralelizamos extracci\u00f3n de slots y b\u00fasqueda RAG. Ambas son I/O
  // async; ejecutarlas en serie a\u00f1adir\u00eda ~2s. El RAG se lanza SIEMPRE
  // salvo que el mensaje sea trivialmente un slot esperado (yes/no,
  // n\u00famero corto, palabra suelta). No usamos allowlist de keywords
  // porque cada tenant tiene vocabulario distinto (hoteler\u00eda, legal,
  // salud, retail...). El gate anti-alucinaci\u00f3n
  // (MIN_SCORE_FOR_ANSWER=0.3 + fallback honesto en rag.ts) ya rechaza
  // queries irrelevantes con respuesta pruden te.
  const needsRag =
    runtimeConfig.tenantId !== "fallback" && !looksLikeSlotAnswer(userMessage);
  const [slots, ragAnswer] = await Promise.all([
    extractSlots(env, userMessage, context, runtimeConfig),
    needsRag ? resolveRagAnswer(env, runtimeConfig, userMessage) : Promise.resolve(undefined),
  ]);

  const result = await stub.processTurn(voiceRequest.callSid, userMessage, slots, runtimeConfig, {
    maxTurns: turnLimit,
    ragAnswer,
  });
  console.log(
    JSON.stringify({
      message: "voice turn",
      callSid: voiceRequest.callSid,
      state: result.dialogState,
      complete: result.isComplete,
      responseLength: result.responseText.length,
      missingSlots: result.missingSlots,
      urgent: result.urgent === true,
      confidence: voiceRequest.confidence ?? null,
      turnCount: result.turnCount ?? null,
      turnLimitReached: result.turnLimitReached === true,
    }),
  );

  if (result.isComplete) {
    if (result.dialogState === "booked" && result.slots) {
      await recordConfirmedLead(
        env,
        runtimeConfig,
        voiceRequest.callSid,
        voiceRequest.from,
        result.slots,
        { urgent: result.urgent, phrase: result.urgencyPhrase },
        ctx,
      );
    }

    return twimlSayAndHangup(result.responseText, runtimeConfig.language, runtimeConfig.voice);
  }

  return twimlGather({
    action: "/webhook/voice/process",
    message: result.responseText,
    language: runtimeConfig.language,
    voice: runtimeConfig.voice,
    hints: runtimeConfig.speechHints,
    speechTimeout: runtimeConfig.speechTimeout,
    timeout: runtimeConfig.timeout,
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

// Heur\u00edstica barata para decidir si vale la pena lanzar RAG. Evita el
// overhead (embedding + query + LLM ~1-2s) cuando el mensaje es solo un
// nombre, un tel\u00e9fono o una confirmaci\u00f3n. Copia local para no
// exportar la del DO.
// Heur\u00edstica ESTRUCTURAL multitenant. En vez de allowlist de keywords
// (que romp\u00eda con cada vertical nuevo), detectamos si el mensaje es
// trivialmente una respuesta a un slot esperado. Si NO lo es, corremos
// RAG y dejamos que el score m\u00ednimo + fallback honesto decida.
//
// Retorna true (skip RAG) cuando el mensaje es:
//   - S\u00ed / No / OK / Gracias / etc. (afirmaciones cortas)
//   - Un solo n\u00famero (tel\u00e9fono, cantidad, hora)
//   - Muy corto (<6 chars) sin signos de interrogaci\u00f3n
//   - Solo una fecha/hora (parseable como tiempo)
//
// Todo lo dem\u00e1s dispara RAG. El vector search es barato y filtered by
// tenant, y el gate MIN_SCORE_FOR_ANSWER descarta si no hay match real.
function looksLikeSlotAnswer(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  // Confirmaciones/negaciones/agradecimientos cortos
  if (/^(s[ií]|no|ok|okey|okay|correcto|as[ií] es|efectivamente|claro|por supuesto|gracias|adi[oó]s|nada m[aá]s|est[aá] bien|de acuerdo|listo|entendido)[\s.!?,]*$/i.test(m)) return true;
  // Solo n\u00fameros (tel\u00e9fono, cantidad, hora suelta)
  if (/^[\d\s\-+().]+$/.test(m) && m.replace(/\D/g, "").length >= 3) return true;
  // Muy corto sin signo de pregunta \u2014 probablemente nombre o palabra suelta
  if (m.length < 6 && !/[?¿]/.test(m)) return true;
  // Todo lo dem\u00e1s: intentar RAG
  return false;
}

async function resolveRagAnswer(
  env: Env,
  runtimeConfig: RuntimePromptConfig,
  userMessage: string,
): Promise<InjectedRagAnswer | undefined> {
  try {
    const fragments = await searchKnowledgeContext(env, runtimeConfig.tenantId, userMessage);
    if (!fragments.length) {
      console.log(
        JSON.stringify({
          message: "rag: no fragments found",
          tenantId: runtimeConfig.tenantId,
        }),
      );
      return undefined;
    }
    const answer = await answerFromContext(env, runtimeConfig, userMessage, fragments);
    if (!answer) return undefined;
    console.log(
      JSON.stringify({
        message: "rag: answered",
        tenantId: runtimeConfig.tenantId,
        origin: answer.origin,
        answerLength: answer.answer.length,
      }),
    );
    return { answer: answer.answer, origin: answer.origin };
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "rag: pipeline failed, continuing without answer",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return undefined;
  }
}
