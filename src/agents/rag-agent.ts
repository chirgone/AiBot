// RAG h\u00edbrido sobre knowledge_sources.
//
// Estrategia:
//   1. Vectorize (sem\u00e1ntico) — si RAG_ENABLED='true' y hay embeddings.
//      Ranquea por similitud coseno. Filtra por tenant_id en metadata.
//   2. D1 FTS5 (l\u00e9xico) — fallback siempre disponible. Ranquea por bm25.
//   3. LIKE (\u00faltimo recurso) — si FTS5 no matchea, hace un LIKE tolerante.
//
// El bot usa searchKnowledgeContext() para obtener 1-3 fragmentos y luego
// llama a answerFromContext() para que Workers AI reformule la respuesta
// en tono conversacional corto y hablable.
//
// Timeouts agresivos: cada capa tiene 2s de budget. La llamada al LLM
// tiene 3s. Si algo excede, se cae a la siguiente estrategia.

import type { RuntimePromptConfig } from "../types";

export interface KnowledgeFragment {
  sourceId: string;
  title: string | null;
  summary: string;
  url: string;
  score: number;
  origin: "vectorize" | "fts5" | "like";
}

export interface RagAnswer {
  answer: string;
  fragments: KnowledgeFragment[];
  origin: KnowledgeFragment["origin"];
}

const VECTORIZE_TIMEOUT_MS = 2000;
const FTS_TIMEOUT_MS = 1500;
const LLM_TIMEOUT_MS = 3000;
const EMBEDDING_TIMEOUT_MS = 1500;

// M\u00e1ximo de fragmentos que pasamos al LLM. 3 es el equilibrio entre
// contexto \u00fatil y latencia/tokens.
const TOP_K = 3;

// Score m\u00ednimo para considerar un match de Vectorize confiable. bge-m3
// con coseno t\u00edpicamente arroja 0.55+ para matches buenos. Debajo de 0.5
// el LLM tiende a alucinar rellenando el contexto d\u00e9bil.
const VECTORIZE_MIN_SCORE = 0.5;

// Score m\u00ednimo global para invocar al LLM reformulador. Por debajo de
// esto, aunque tengamos fragments (via FTS5 o LIKE d\u00e9bil), preferimos
// responder honestamente con "no tengo ese dato" que arriesgar
// alucinaciones. Se aplica en answerFromContext.
const MIN_SCORE_FOR_ANSWER = 0.3;

export async function searchKnowledgeContext(
  env: Env,
  tenantId: string,
  query: string,
): Promise<KnowledgeFragment[]> {
  if (!query.trim() || tenantId === "fallback") return [];

  // Fase 2: Vectorize. Si falla, se cae a FTS5. No bloqueamos por errores
  // de Vectorize — el sistema debe seguir respondiendo.
  if (env.RAG_ENABLED === "true") {
    try {
      const vectorHits = await Promise.race([
        vectorizeSearch(env, tenantId, query),
        timeout<KnowledgeFragment[]>(VECTORIZE_TIMEOUT_MS, "vectorize"),
      ]);
      if (vectorHits.length && vectorHits[0].score >= VECTORIZE_MIN_SCORE) {
        console.log(
          JSON.stringify({
            message: "rag: vectorize hit",
            tenantId,
            top: vectorHits[0].score,
            count: vectorHits.length,
          }),
        );
        return vectorHits;
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          message: "rag: vectorize failed, falling back to fts",
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  // Fase 1: FTS5.
  try {
    const ftsHits = await Promise.race([
      ftsSearch(env, tenantId, query),
      timeout<KnowledgeFragment[]>(FTS_TIMEOUT_MS, "fts5"),
    ]);
    if (ftsHits.length) {
      console.log(
        JSON.stringify({
          message: "rag: fts5 hit",
          tenantId,
          count: ftsHits.length,
        }),
      );
      return ftsHits;
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "rag: fts5 failed, falling back to LIKE",
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  // \u00daltimo recurso: LIKE. \u00datil cuando la query tiene errores tipogr\u00e1ficos
  // o palabras que FTS5 tokeniza raro.
  return await likeSearch(env, tenantId, query);
}

// Genera la respuesta natural desde los fragmentos. Si no hay LLM
// disponible (o falla), devuelve el snippet crudo m\u00e1s relevante.
export async function answerFromContext(
  env: Env,
  config: RuntimePromptConfig,
  userQuestion: string,
  fragments: KnowledgeFragment[],
): Promise<RagAnswer | undefined> {
  if (!fragments.length) return undefined;

  // Si el mejor fragment tiene score muy bajo, devolvemos la respuesta
  // honesta de "no tengo ese dato" para evitar que el LLM invente sobre
  // contexto irrelevante. Esta es la barrera anti-alucinaci\u00f3n.
  const bestScore = fragments[0].score;
  if (bestScore < MIN_SCORE_FOR_ANSWER) {
    console.log(
      JSON.stringify({
        message: "rag: score too low, returning honest fallback",
        bestScore,
        threshold: MIN_SCORE_FOR_ANSWER,
      }),
    );
    return {
      answer: "No tengo ese dato exacto, pero un compa\u00f1ero del equipo puede confirm\u00e1rtelo. \u00bfTe interesa que te contacten?",
      fragments,
      origin: fragments[0].origin,
    };
  }

  const contextText = fragments
    .slice(0, TOP_K)
    .map((fragment, index) => `[${index + 1}] ${fragment.title ?? "Sitio"}: ${fragment.summary.slice(0, 400)}`)
    .join("\n\n");

  try {
    const result = await Promise.race([
      env.AI.run(env.AI_MODEL, {
        messages: [
          {
            role: "system",
            content: `Eres el asistente de voz de ${config.businessName}. Responde en espa\u00f1ol de M\u00e9xico, en UNA SOLA oraci\u00f3n breve, natural y directa, apta para leerse en voz alta.

REGLAS ABSOLUTAS (violarlas es un error grave):
1. Solo puedes afirmar hechos que APAREZCAN LITERALMENTE en el CONTEXTO. Nada m\u00e1s.
2. Si la pregunta del cliente NO puede responderse con el contexto dado, responde EXACTAMENTE con esta frase y nada m\u00e1s: "No tengo ese dato exacto, pero un compa\u00f1ero del equipo puede confirm\u00e1rtelo. \u00bfTe interesa que te contacten?"
3. PROHIBIDO inventar nombres propios (restaurantes, personas, marcas, lugares) que no est\u00e9n en el contexto.
4. PROHIBIDO inventar precios, tel\u00e9fonos, horarios, direcciones, promociones o disponibilidad.
5. M\u00e1ximo 30 palabras. Sin listas, sin markdown.
6. No digas "seg\u00fan el sitio" ni "seg\u00fan la informaci\u00f3n"; habla natural.
7. Si respondes con datos del contexto, cierra con una pregunta breve que ayude al cliente a avanzar.`,
          },
          {
            role: "user",
            content: `CONTEXTO (\u00fanica fuente v\u00e1lida de datos):\n${contextText}\n\nPREGUNTA DEL CLIENTE: ${userQuestion}\n\nAplica las REGLAS ABSOLUTAS. Responde en una sola oraci\u00f3n.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 128,
      }),
      timeout<unknown>(LLM_TIMEOUT_MS, "llm"),
    ]);

    const answer = extractLlmText(result);
    if (answer) {
      return {
        answer: cleanVoiceAnswer(answer),
        fragments,
        origin: fragments[0].origin,
      };
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "rag: llm reformulation failed, using raw fragment",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  // Fallback: primer fragmento crudo, truncado para voz.
  const raw = fragments[0].summary.split(/(?<=[.!?])\s+/)[0] ?? fragments[0].summary;
  return {
    answer: cleanVoiceAnswer(raw),
    fragments,
    origin: fragments[0].origin,
  };
}

// Indexaci\u00f3n: convierte un knowledge_source en un vector y lo sube a
// Vectorize. Se llama desde el scanner despu\u00e9s de actualizar el summary.
// Idempotente: sobrescribe el vector si ya exist\u00eda con el mismo id.
export async function indexKnowledgeSource(
  env: Env,
  source: { id: string; tenantId: string; url: string; title: string | null; summary: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!source.summary.trim() || env.RAG_ENABLED !== "true") {
    return { ok: false, error: "empty summary or rag disabled" };
  }

  try {
    const text = `${source.title ?? ""}\n${source.summary}`.slice(0, 8000);
    const embedding = await Promise.race([
      generateEmbedding(env, text),
      timeout<number[]>(EMBEDDING_TIMEOUT_MS, "embedding"),
    ]);

    await env.VECTORIZE.upsert([
      {
        id: source.id,
        values: embedding,
        metadata: {
          tenant_id: source.tenantId,
          source_id: source.id,
          url: source.url,
        },
      },
    ]);

    await env.DB.prepare(
      `UPDATE knowledge_sources SET vectorized_at = strftime('%s','now') WHERE id = ?`,
    )
      .bind(source.id)
      .run();

    return { ok: true };
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "rag: indexing failed",
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function vectorizeSearch(
  env: Env,
  tenantId: string,
  query: string,
): Promise<KnowledgeFragment[]> {
  const embedding = await generateEmbedding(env, query);
  const result = await env.VECTORIZE.query(embedding, {
    topK: TOP_K,
    filter: { tenant_id: tenantId },
    returnMetadata: "all",
  });

  const matches = result.matches ?? [];
  if (!matches.length) return [];

  // Hidratamos los summaries desde D1 (Vectorize no guarda el texto full,
  // s\u00f3lo metadata liviana).
  const ids = matches.map((match) => String(match.id));
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, url FROM knowledge_sources WHERE tenant_id = ? AND id IN (${placeholders})`,
  )
    .bind(tenantId, ...ids)
    .all<{ id: string; title: string | null; summary: string | null; url: string }>();

  const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));
  const fragments: KnowledgeFragment[] = [];
  for (const match of matches) {
    const row = byId.get(String(match.id));
    if (!row || !row.summary) continue;
    fragments.push({
      sourceId: row.id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      score: match.score ?? 0,
      origin: "vectorize",
    });
  }
  return fragments;
}

async function ftsSearch(env: Env, tenantId: string, query: string): Promise<KnowledgeFragment[]> {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  const rows = await env.DB.prepare(
    `SELECT ks.id, ks.title, ks.summary, ks.url, bm25(knowledge_sources_fts) AS rank
       FROM knowledge_sources_fts
       JOIN knowledge_sources ks ON ks.rowid = knowledge_sources_fts.rowid
      WHERE knowledge_sources_fts MATCH ?
        AND ks.tenant_id = ?
        AND ks.status = 'scanned'
        AND ks.summary IS NOT NULL
      ORDER BY rank ASC
      LIMIT ?`,
  )
    .bind(sanitized, tenantId, TOP_K)
    .all<{ id: string; title: string | null; summary: string | null; url: string; rank: number }>();

  return (rows.results ?? [])
    .filter((row) => row.summary)
    .map((row) => ({
      sourceId: row.id,
      title: row.title,
      summary: row.summary!,
      url: row.url,
      // bm25 devuelve negativos: m\u00e1s cerca de 0 es mejor. Normalizamos a
      // 0..1 aproximado para el consumidor.
      score: 1 / (1 + Math.abs(row.rank)),
      origin: "fts5" as const,
    }));
}

async function likeSearch(env: Env, tenantId: string, query: string): Promise<KnowledgeFragment[]> {
  // Filtramos stopwords para no buscar por "puedes", "quiero", etc. que
  // matchean cualquier p\u00e1gina y contaminan el contexto.
  const tokens = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
    .slice(0, 3);
  if (!tokens.length) return [];

  const pattern = `%${tokens[0]}%`;
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, url
       FROM knowledge_sources
      WHERE tenant_id = ?
        AND status = 'scanned'
        AND summary IS NOT NULL
        AND (LOWER(summary) LIKE ? OR LOWER(title) LIKE ?)
      LIMIT ?`,
  )
    .bind(tenantId, pattern, pattern, TOP_K)
    .all<{ id: string; title: string | null; summary: string | null; url: string }>();

  return (rows.results ?? [])
    .filter((row) => row.summary)
    .map((row) => ({
      sourceId: row.id,
      title: row.title,
      summary: row.summary!,
      url: row.url,
      score: 0.2,
      origin: "like" as const,
    }));
}

async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  const result = await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, { text });
  // bge-m3 responde { data: number[][] } o { data: [{ embedding: number[] }] }
  // seg\u00fan versi\u00f3n. Soportamos ambos shapes.
  if (isRecord(result) && "data" in result) {
    const data = (result as { data: unknown }).data;
    if (Array.isArray(data) && data.length) {
      const first = data[0];
      if (Array.isArray(first) && first.every((value) => typeof value === "number")) {
        return first as number[];
      }
      if (isRecord(first) && Array.isArray((first as { embedding?: unknown }).embedding)) {
        return (first as { embedding: number[] }).embedding;
      }
    }
  }
  throw new Error("embedding: unexpected response shape");
}

// FTS5 rechaza queries con caracteres como comillas, punto y coma o
// palabras muy cortas. Extraemos tokens \u00fatiles y los unimos con OR.
// Ejemplo: "\u00bftienen alberca?" -> "alberca"
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .slice(0, 8);
  if (!tokens.length) return "";
  // Prefix search + OR: cubre morfolog\u00eda (alberca/alberc*) y sin\u00f3nimos
  // que el usuario pudo haber cortado.
  return tokens.map((token) => `${token}*`).join(" OR ");
}

const STOPWORDS = new Set([
  "que", "cual", "cuales", "como", "donde", "cuando", "por", "para", "los", "las",
  "una", "unos", "unas", "con", "sin", "del", "hay", "tiene", "tienen", "ofrecen",
  "manejan", "cuentan", "puede", "pueden", "quiero", "necesito", "sobre", "esta",
  "este", "estos", "estas", "eso", "esa", "esos", "esas", "hola", "buen", "buenos",
  "buenas", "dia", "dias", "noche", "tarde", "gracias", "porque", "porqu",
]);

function cleanVoiceAnswer(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    // Quita frases de meta-referencia t\u00edpicas del LLM.
    .replace(/^(seg[uú]n (el sitio|la informaci[oó]n|el contexto),?\s*)/i, "")
    .replace(/^(basado en (el contexto|la informaci[oó]n),?\s*)/i, "")
    .trim()
    .slice(0, 320);
}

function extractLlmText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return undefined;
  const candidates = ["response", "text", "content", "output"] as const;
  for (const key of candidates) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
}
