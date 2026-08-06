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
  // async; ejecutarlas en serie a\u00f1adir\u00eda ~2s. El RAG s\u00f3lo se lanza si
  // el mensaje parece pregunta de conocimiento y hay tenant real.
  const needsRag =
    runtimeConfig.tenantId !== "fallback" && looksLikeKnowledgeQuery(userMessage);
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
// Heur\u00edstica multi-vertical: matchea intent de "quiero saber sobre X".
// Cubre verbos gen\u00e9ricos (saber, conocer, contar, explicar, dime),
// pronombres interrogativos (qu\u00e9, cu\u00e1l, c\u00f3mo, d\u00f3nde, cu\u00e1nto),
// y sustantivos comunes de discovery empresarial (reconocimientos,
// estrategia, valor, misi\u00f3n, visi\u00f3n, equipo, certificaciones, experiencia,
// soluciones, tecnolog\u00eda, empresa, servicios, productos) + verticales
// (hoteler\u00eda, salud, retail, educaci\u00f3n, gobierno). Si dudas, deja pasar
// \u2014 el gate anti-alucinaci\u00f3n de score m\u00ednimo se encarga de rechazar
// preguntas irrelevantes con fallback honesto.
function looksLikeKnowledgeQuery(message: string): boolean {
  if (message.length < 6) return false;
  const m = message.toLowerCase();
  // Verbos e intents de "quiero saber / cu\u00e9ntame / dime / explica"
  if (/\b(quiero saber|me interesa saber|puedes decirme|quiero conocer|dime|dime m[aá]s|cu[eé]ntame|explica|expl[ií]came|platicame|plat[ií]came|h[aá]blame|sabe[rn]|conocer|saber sobre|informaci[oó]n sobre|informame|infoacerca|acerca de|sobre su|sobre sus|sobre el|sobre la|sobre los|sobre las)\b/i.test(m)) return true;
  // Pronombres interrogativos
  if (/\b(qu[eé]|cu[aá]l|cu[aá]les|d[oó]nde|c[oó]mo|cu[aá]ndo|por qu[eé]|para qu[eé]|cu[aá]nto|cu[aá]ntos|cu[aá]ntas)\b/i.test(m)) return true;
  // Sustantivos universales de discovery
  if (/\b(reconocimiento|reconocimientos|premio|premios|estrategia|estrategias|valor|valores|visi[oó]n|misi[oó]n|prop[oó]sito|equipo|equipos|nosotros|acerca|empresa|compa[nñ][ií]a|firma|hist[oó]ria|historia|trayectoria|experiencia|especialidad|especialidades|certificaci[oó]n|certificaciones|acreditaci[oó]n|acreditaciones|alianza|alianzas|partner|partners|socio|socios|cliente|clientes|caso|casos|proyecto|proyectos|tecnolog[ií]a|tecnolog[ií]as|soluci[oó]n|soluciones|servicio|servicios|producto|productos|catalogo|cat[aá]logo|industria|industrias|sector|sectores|\u00e1rea|\u00e1reas|area|areas|pr[aá]ctica|pr[aá]cticas|especial|beneficio|beneficios|membres[ií]a|membres[ií]as|paquete|paquetes|oferta|ofertas|promoci[oó]n|promociones|descuento|descuentos|precio|precios|costo|costos|tarifa|tarifas|contacto|contactos|direcci[oó]n|ubicaci[oó]n|sucursal|sucursales|horario|horarios|tel[eé]fono|correo|email|whatsapp)\b/i.test(m)) return true;
  // Verticales espec\u00edficas (hoteler\u00eda, salud, retail, educaci\u00f3n)
  if (/\b(habitaci[oó]n|habitaciones|cuarto|cuartos|suite|suites|alberca|spa|estacionamiento|wifi|mascota|mascotas|desayuno|check-?in|reserva|reservas|hotel|hoteles|resort|resorts|doctor|doctora|especialista|especialistas|cl[ií]nica|hospital|carrera|carreras|curso|cursos|programa|programas|admisi[oó]n|tramite|tr[aá]mite|permiso|licencia)\b/i.test(m)) return true;
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
