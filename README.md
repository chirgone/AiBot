# Agentica Voice MVP

Agente telefónico de captura de solicitudes y asesorías para Alta Sistemas usando Cloudflare Workers, Durable Objects, Workers AI y Twilio. El guion está enfocado en una propuesta integral de tecnología para negocios mexicanos y soluciones tecnológicas inteligentes para la operación.

## Estado Actual

- Worker desplegado: `agentica-voice`
- Dominio: `https://agentica.angaflow.mx`
- Documentación: `https://help.angaflow.mx`
- Health check: `https://agentica.angaflow.mx/health`
- Twilio inbound webhook: `https://agentica.angaflow.mx/webhook/voice`
- Voz actual: `Polly.Mia-Neural`
- Idioma: `es-MX`
- STT Twilio: `<Gather input="speech" speechTimeout="2" timeout="6">`
- Asistente: `Tania Duran`
- Negocio: `Alta Sistemas`
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
  --data-urlencode 'SpeechResult=Hola soy Carlos, necesito una propuesta de ciberseguridad con monitoreo 24/7 mañana a las cuatro de la tarde'
```

## Twilio

En el número `+18454090168`, configura el webhook de voz entrante:

- Method: `POST`
- URL: `https://<tu-worker>.workers.dev/webhook/voice`

Twilio enviará el resultado de cada `<Gather>` a `/webhook/voice/process`.

## Flujo Conversacional Actual

1. Tania Duran saluda y pide el nombre.
2. Tania pregunta sobre qué servicio está interesado el cliente: Cómputo y DaaS, Servidores y Nube OnPremise, Redes/Ciberseguridad/Videovigilancia, SOC/NOC 24/7, Videocolaboración/Automatización de Espacios o Arrendamiento Tecnológico.
3. Tania pide día y hora para que contacte un especialista.
4. Tania confirma la asesoría con fecha en lenguaje natural.
5. Si el usuario responde afirmativamente, la solicitud se guarda en SQLite dentro del Durable Object.

## Fuentes De Servicio

- Cómputo y DaaS: `https://www.altasistemas.mx/servicios/computo-daas`
- Servidores y Nube OnPremise: `https://www.altasistemas.mx/servicios/servidores-nube`
- Redes, Ciberseguridad y Videovigilancia: `https://www.altasistemas.mx/servicios/redes-ciberseguridad`
- SOC & NOC as a Service: `https://www.altasistemas.mx/servicios/soc-noc`
- Videocolaboración y Automatización de Espacios: `https://www.altasistemas.mx/servicios/videocolaboracion-automatizacion`
- Arrendamiento Tecnológico Empresarial: `https://www.altasistemas.mx/servicios/arrendamiento-ti`

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
