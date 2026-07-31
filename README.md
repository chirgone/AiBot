# Agentica Voice MVP

Agente telefónico de citas para PyMEs usando Cloudflare Workers, Durable Objects, Workers AI y Twilio.

## Estado Actual

- Worker desplegado: `agentica-voice`
- Dominio: `https://agentica.angaflow.mx`
- Health check: `https://agentica.angaflow.mx/health`
- Twilio inbound webhook: `https://agentica.angaflow.mx/webhook/voice`
- Voz actual: `Polly.Mia-Neural`
- Idioma: `es-MX`
- STT Twilio: `<Gather input="speech" speechModel="experimental_conversations">`
- Seguridad temporal: `SKIP_SIGNATURE_VALIDATION="true"` para desbloquear el MVP. Rehabilitar validación de firma antes de producción.

## Stack

- Cloudflare Worker: webhook HTTP para Twilio.
- Durable Object `VoiceAgent`: estado por llamada (`CallSid`) con SQLite.
- Workers AI: extracción estructurada de slots en español.
- Twilio Voice: número telefónico, `<Gather input="speech">`, STT/TTS y TwiML.

## Setup

1. Instala dependencias:

```bash
npm install
```

2. Genera tipos desde `wrangler.jsonc`:

```bash
npm run types
```

3. Configura secretos. No los guardes en archivos:

```bash
npx wrangler secret put TWILIO_AUTH_TOKEN
```

4. Para pruebas locales con `curl`, crea `.dev.vars` local y no lo subas a git:

```bash
TWILIO_AUTH_TOKEN="tu-token"
SKIP_SIGNATURE_VALIDATION="true"
```

5. Levanta el Worker:

```bash
npm run dev
```

## Prueba Local

```bash
curl -X POST http://localhost:8787/webhook/voice \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'CallSid=CA123&From=%2B525512345678&To=%2B18454090168'
```

```bash
curl -X POST http://localhost:8787/webhook/voice/process \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=CA123' \
  --data-urlencode 'From=+525512345678' \
  --data-urlencode 'To=+18454090168' \
  --data-urlencode 'SpeechResult=Hola soy Carlos, quiero una limpieza dental mañana a las cuatro de la tarde'
```

## Twilio

En el número `+18454090168`, configura el webhook de voz entrante:

- Method: `POST`
- URL: `https://<tu-worker>.workers.dev/webhook/voice`

Twilio enviará el resultado de cada `<Gather>` a `/webhook/voice/process`.

## Flujo Conversacional Actual

1. Sofía saluda y pide el nombre.
2. Sofía pide día y hora de la cita.
3. Sofía pide el motivo.
4. Sofía confirma la cita con fecha en lenguaje natural.
5. Si el usuario responde afirmativamente, la cita se guarda en SQLite dentro del Durable Object.

## Deploy Actual

```bash
npm run types
npm run check
npm run deploy
```

## Seguridad

- El Worker valida `X-Twilio-Signature` por default usando `TWILIO_AUTH_TOKEN`.
- Usa `SKIP_SIGNATURE_VALIDATION="true"` solo en local.
- Si un token fue compartido por chat, rótalo en Twilio antes de producción.

Nota: en el estado actual del MVP, `SKIP_SIGNATURE_VALIDATION` está habilitado también en `wrangler.jsonc` para llamadas de prueba. No dejar así en producción.
