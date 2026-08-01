export function renderHelpPage(): Response {
  return new Response(helpPageHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

const helpPageHtml = String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentica Help | Alta Sistemas Voice Agent</title>
    <meta
      name="description"
      content="Documentación del agente telefónico Tania Duran para Alta Sistemas, construido con Twilio, Cloudflare Workers, Durable Objects y Workers AI."
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6fb;
        --ink: #132033;
        --muted: #5d6b7d;
        --brand: #0a63ce;
        --brand-dark: #073f82;
        --card: #ffffff;
        --line: #dce5f2;
        --soft: #eaf2ff;
        --ok: #0b7a4b;
        --warn: #aa5b00;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(10, 99, 206, 0.18), transparent 34rem),
          linear-gradient(180deg, #ffffff 0%, var(--bg) 42rem);
        color: var(--ink);
        line-height: 1.55;
      }

      a {
        color: var(--brand);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      header {
        max-width: 1120px;
        margin: 0 auto;
        padding: 48px 24px 24px;
      }

      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 0 24px 64px;
      }

      .eyebrow {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 8px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--brand-dark);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      h1 {
        max-width: 900px;
        margin: 24px 0 16px;
        font-size: clamp(40px, 7vw, 76px);
        line-height: 0.94;
        letter-spacing: -0.06em;
      }

      h2 {
        margin: 0 0 16px;
        font-size: clamp(24px, 4vw, 36px);
        line-height: 1.05;
        letter-spacing: -0.035em;
      }

      h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      p {
        margin: 0 0 14px;
      }

      .lead {
        max-width: 780px;
        color: var(--muted);
        font-size: clamp(18px, 2vw, 22px);
      }

      .hero-grid {
        display: grid;
        grid-template-columns: 1.6fr 1fr;
        gap: 24px;
        align-items: stretch;
        margin-top: 32px;
      }

      .panel,
      .card {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 24px 70px rgba(19, 32, 51, 0.08);
      }

      .panel {
        padding: 26px;
      }

      .status {
        display: grid;
        gap: 12px;
      }

      .status-item {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--line);
      }

      .status-item:last-child {
        border-bottom: 0;
      }

      .label {
        color: var(--muted);
      }

      .value {
        text-align: right;
        font-weight: 750;
      }

      .section {
        margin-top: 28px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }

      .card {
        padding: 20px;
      }

      .card p,
      li {
        color: var(--muted);
      }

      .badge {
        display: inline-flex;
        margin-bottom: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--soft);
        color: var(--brand-dark);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .flow {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        counter-reset: step;
      }

      .step {
        position: relative;
        padding: 20px;
        border-radius: 20px;
        background: var(--card);
        border: 1px solid var(--line);
      }

      .step::before {
        counter-increment: step;
        content: counter(step);
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        margin-bottom: 14px;
        border-radius: 50%;
        background: var(--brand);
        color: white;
        font-weight: 800;
      }

      code,
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      pre {
        overflow: auto;
        padding: 18px;
        border-radius: 18px;
        border: 1px solid #12345b;
        background: #081526;
        color: #d9ecff;
      }

      ul {
        padding-left: 20px;
      }

      .callout {
        border-left: 5px solid var(--warn);
        background: #fff8ed;
      }

      .ok {
        border-left: 5px solid var(--ok);
        background: #f0fff8;
      }

      .footer {
        margin-top: 32px;
        color: var(--muted);
        font-size: 14px;
      }

      @media (max-width: 900px) {
        .hero-grid,
        .grid,
        .flow {
          grid-template-columns: 1fr;
        }

        header {
          padding-top: 32px;
        }

        .value {
          text-align: left;
        }

        .status-item {
          display: block;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <span class="eyebrow">Agentica Voice MVP · Alta Sistemas</span>
      <h1>Tania Duran, agente de voz para capturar y calificar solicitudes TI.</h1>
      <p class="lead">
        Documentación operativa del agente telefónico construido con Twilio Voice, Cloudflare Workers,
        Durable Objects, SQLite y Workers AI. El objetivo es canalizar prospectos hacia una asesoría con
        especialistas de Alta Sistemas.
      </p>
      <div class="hero-grid">
        <section class="panel">
          <h2>Saludo De Marca</h2>
          <p>
            <strong>Guion inicial:</strong> Gracias por llamar a Alta Sistemas, soluciones tecnológicas inteligentes para
            la operación de negocios mexicanos. Soy Tania Duran. Te ayudo a canalizar tu solicitud con un especialista.
            Para empezar, ¿me regalas tu nombre?
          </p>
          <p>
            El flujo prioriza calificación antes de agenda: primero identifica el servicio de interés y después propone
            coordinar fecha y hora con un especialista.
          </p>
        </section>
        <aside class="panel status">
          <div class="status-item"><span class="label">Worker</span><span class="value">agentica-voice</span></div>
          <div class="status-item"><span class="label">Dominio voz</span><span class="value">agentica.angaflow.mx</span></div>
          <div class="status-item"><span class="label">Dominio help</span><span class="value">help.angaflow.mx</span></div>
          <div class="status-item"><span class="label">Webhook Twilio</span><span class="value">/webhook/voice</span></div>
          <div class="status-item"><span class="label">Voz</span><span class="value">Polly.Mia-Neural</span></div>
          <div class="status-item"><span class="label">Idioma</span><span class="value">es-MX</span></div>
        </aside>
      </div>
    </header>

    <main>
      <section class="section panel">
        <h2>Flujo Conversacional</h2>
        <div class="flow">
          <div class="step">
            <h3>Identificación</h3>
            <p>Tania saluda con branding de Alta Sistemas y solicita el nombre del contacto.</p>
          </div>
          <div class="step">
            <h3>Servicio De Interés</h3>
            <p>Pregunta si el prospecto busca Cómputo/DaaS, Nube OnPremise, Redes, SOC/NOC, Videocolaboración o Arrendamiento.</p>
          </div>
          <div class="step">
            <h3>Agenda</h3>
            <p>Después de calificar el servicio, solicita día y hora para contacto con especialista.</p>
          </div>
          <div class="step">
            <h3>Confirmación</h3>
            <p>Repite nombre, servicio y horario. Si el usuario confirma, guarda la solicitud y cuelga.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Servicios Alta Sistemas</h2>
        <div class="grid">
          <article class="card">
            <span class="badge">Cómputo y DaaS</span>
            <h3>Servicios Administrados de Cómputo</h3>
            <p>Suministro, configuración, mantenimiento preventivo, soporte, actualizaciones y reemplazo de equipo obsoleto.</p>
            <p><a href="https://www.altasistemas.mx/servicios/computo-daas">Fuente oficial</a></p>
          </article>
          <article class="card">
            <span class="badge">Nube OnPremise</span>
            <h3>Servidores, Data Center y Nube Privada</h3>
            <p>Infraestructura segura y escalable para control total de datos, alto rendimiento y continuidad operativa.</p>
            <p><a href="https://www.altasistemas.mx/servicios/servidores-nube">Fuente oficial</a></p>
          </article>
          <article class="card">
            <span class="badge">Redes y Seguridad</span>
            <h3>Redes, Ciberseguridad y Videovigilancia</h3>
            <p>Redes WiFi/LAN, protección avanzada, CCTV inteligente, alertas 24/7 y evaluación de vulnerabilidades.</p>
            <p><a href="https://www.altasistemas.mx/servicios/redes-ciberseguridad">Fuente oficial</a></p>
          </article>
          <article class="card">
            <span class="badge">SOC & NOC</span>
            <h3>Monitoreo 24/7</h3>
            <p>Supervisión de red, sistemas críticos y ciberseguridad con respuesta inmediata, análisis forense y reportes.</p>
            <p><a href="https://www.altasistemas.mx/servicios/soc-noc">Fuente oficial</a></p>
          </article>
          <article class="card">
            <span class="badge">Videocolaboración</span>
            <h3>Automatización De Espacios</h3>
            <p>Soluciones AV, audioconferencia, salas híbridas, control de iluminación, clima, persianas y equipos audiovisuales.</p>
            <p><a href="https://www.altasistemas.mx/servicios/videocolaboracion-automatizacion">Fuente oficial</a></p>
          </article>
          <article class="card">
            <span class="badge">Arrendamiento TI</span>
            <h3>Arrendamiento Tecnológico Empresarial</h3>
            <p>Leasing, planes flexibles, actualización continua, modelos DaaS y financiamiento para modernizar sin descapitalizar.</p>
            <p><a href="https://www.altasistemas.mx/servicios/arrendamiento-ti">Fuente oficial</a></p>
          </article>
        </div>
      </section>

      <section class="section panel ok">
        <h2>Qué Se Guarda</h2>
        <p>La información se guarda dentro del Durable Object asociado al <span class="mono">CallSid</span> de Twilio.</p>
        <ul>
          <li><strong>conversations:</strong> estado de la llamada, nombre, teléfono, fecha/hora y servicio.</li>
          <li><strong>messages:</strong> historial de turnos de usuario y asistente.</li>
          <li><strong>appointments:</strong> solicitudes confirmadas por el usuario.</li>
        </ul>
      </section>

      <section class="section panel">
        <h2>Endpoints</h2>
        <pre><code>GET  /health
POST /webhook/voice
POST /webhook/voice/process</code></pre>
        <p>
          El número de Twilio debe apuntar a <span class="mono">https://agentica.angaflow.mx/webhook/voice</span> con método POST.
        </p>
      </section>

      <section class="section panel callout">
        <h2>Seguridad Pendiente</h2>
        <p>
          El MVP tiene <span class="mono">SKIP_SIGNATURE_VALIDATION=true</span> para facilitar pruebas. Antes de producción se debe rotar
          el token de Twilio y reactivar la validación de <span class="mono">X-Twilio-Signature</span>.
        </p>
      </section>

      <section class="section">
        <h2>Roadmap De Agentes</h2>
        <div class="grid">
          <article class="card"><h3>WhatsApp/SMS Lead Bot</h3><p>Califica prospectos por texto y agenda asesorías.</p></article>
          <article class="card"><h3>Recordatorios Automáticos</h3><p>Confirma o reagenda citas por voz o SMS.</p></article>
          <article class="card"><h3>Emergency Routing</h3><p>Rutea incidentes de seguridad hacia SOC/NOC.</p></article>
          <article class="card"><h3>Encuestas CSAT/NPS</h3><p>Mide satisfacción después de asesorías o tickets.</p></article>
          <article class="card"><h3>Outbound Dialer</h3><p>Llama leads de campañas y transfiere a un especialista.</p></article>
          <article class="card"><h3>Admin Dashboard</h3><p>Lista solicitudes confirmadas y exporta seguimiento comercial.</p></article>
        </div>
      </section>

      <p class="footer">
        Agentica Help · Documentación viva del MVP · Última actualización: 2026-08-01
      </p>
    </main>
  </body>
</html>`;
