export function renderAdminPage(email: string): Response {
  return new Response(adminHtml(email), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function renderAccessRequiredPage(): Response {
  return new Response(accessRequiredHtml, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const DEFAULT_ASSISTANT_NAME = "Asistente virtual";
const DEFAULT_VOICE_NUMBER = "+18454090168";

const VERTICALS = [
  "General / Conversacional",
  "Tecnología / Infraestructura TI",
  "Salud / Clínicas",
  "Retail / Comercio",
  "Hotelería / Hospitalidad",
  "Gobierno / Sector Público",
  "Educación / Escuelas",
  "Servicios Profesionales",
  "Legal / Despachos",
  "Real Estate / Inmobiliaria",
  "Restaurantes / Hospitalidad",
  "Soporte Técnico",
  "Finanzas / Seguros",
  "Manufactura / Industrial",
  "Logística / Transporte",
  "Energía / Utilities",
] as const;

function verticalOptions(): string {
  return VERTICALS.map((vertical) => {
    const safe = escapeHtml(vertical);
    return `<option value="${safe}">${safe}</option>`;
  }).join("");
}

function adminHtml(email: string): string {
  return String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Estudio Conversacional AngaFlow</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111f;
        --panel: rgba(15, 29, 49, 0.86);
        --card: #13243b;
        --ink: #f5f8ff;
        --muted: #9fb0c7;
        --line: #263a58;
        --brand: #62a8ff;
        --brand-2: #9bffc7;
        --ok: #49d17d;
        --warn: #ffbd59;
        --danger: #ff7a90;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 12% 0%, rgba(98,168,255,.22), transparent 34rem),
          radial-gradient(circle at 100% 8%, rgba(73,209,125,.12), transparent 28rem),
          var(--bg);
        color: var(--ink);
      }

      header, main {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 22px;
      }

      header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px;
        align-items: start;
      }

      h1 {
        max-width: 860px;
        margin: 14px 0 12px;
        font-size: clamp(34px, 6vw, 68px);
        line-height: .92;
        letter-spacing: -.06em;
      }

      h2 { margin: 0 0 12px; font-size: clamp(22px, 3vw, 30px); letter-spacing: -.035em; }
      h3 { margin: 0 0 8px; font-size: 17px; }
      h4 { margin: 0 0 8px; font-size: 15px; }
      p { margin: 0 0 14px; color: var(--muted); line-height: 1.55; }
      button, input, select, textarea { font: inherit; }

      button {
        border: 0;
        border-radius: 14px;
        padding: 12px 15px;
        background: var(--brand);
        color: #061120;
        font-weight: 850;
        cursor: pointer;
      }

      button.secondary { background: #223855; color: var(--ink); }
      button.danger { background: rgba(255,122,144,.16); color: #ffd4dc; border: 1px solid rgba(255,122,144,.45); }
      button:disabled { cursor: not-allowed; opacity: .45; }

      input, select, textarea {
        width: 100%;
        border: 1px solid var(--line);
        background: #091729;
        color: var(--ink);
        border-radius: 14px;
        padding: 13px 14px;
        margin-bottom: 10px;
        min-width: 0;
      }

      textarea {
        min-height: 230px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
      }

      .pill {
        display: inline-flex;
        max-width: 100%;
        border: 1px solid var(--line);
        color: var(--muted);
        border-radius: 999px;
        padding: 8px 12px;
        overflow-wrap: anywhere;
      }

      .hero-copy { max-width: 780px; font-size: 18px; }
      .layout { display: grid; grid-template-columns: 410px minmax(0, 1fr); gap: 18px; align-items: start; }
      .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .stack { display: grid; gap: 14px; }
      .sidebar { position: sticky; top: 16px; }
      .nav-toggle, .nav-overlay { display: none; }
      .side-nav { display: grid; gap: 8px; margin-bottom: 18px; }
      .side-link {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--line);
        background: #0b182a;
        color: var(--ink);
        border-radius: 14px;
        padding: 12px 14px;
        text-decoration: none;
        font-weight: 800;
      }
      .side-link span { color: var(--muted); font-size: 12px; font-weight: 700; }
      .side-link.active { outline: 2px solid var(--brand); background: #10233a; }
      .app-view { display: none; }
      .app-view.active { display: block; }
      .accordion { display: grid; gap: 14px; }
      .accordion-section { padding: 0; overflow: hidden; }
      .accordion-heading { margin: 0; font-size: inherit; font-weight: inherit; }
      .accordion-toggle {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        border-radius: 0;
        background: transparent;
        color: var(--ink);
        text-align: left;
        padding: 18px 20px;
      }
      .accordion-toggle span { color: var(--muted); font-size: 13px; font-weight: 700; }
      .accordion-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
      .accordion-toggle::after { content: '+'; color: var(--brand-2); font-size: 22px; line-height: 1; }
      .accordion-section.open .accordion-toggle::after { content: '-'; }
      .accordion-body { display: none; padding: 0 20px 20px; }
      .accordion-section.open .accordion-body { display: block; }

      .leads-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
      .lead-filter { padding: 8px 14px; border-radius: 999px; background: #0b182a; border: 1px solid var(--line); color: var(--muted); font-weight: 700; font-size: 13px; }
      .lead-filter.active { background: var(--brand); color: #061120; border-color: transparent; }
      .lead-filter[disabled] { opacity: .4; cursor: not-allowed; }
      .lead-counter-urgent { color: var(--danger); font-weight: 800; }

      .leads-table { width: 100%; border-collapse: collapse; font-size: 14px; }
      .leads-table thead th { text-align: left; padding: 10px 12px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); }
      .leads-table tbody td { padding: 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
      .leads-table tbody tr.urgent { background: rgba(255, 122, 144, .06); }
      .leads-table tbody tr.urgent td:first-child { border-left: 3px solid var(--danger); }
      .leads-table .lead-name { font-weight: 700; color: var(--ink); }
      .leads-table .lead-phone { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: var(--muted); }
      .leads-table .lead-service { color: var(--ink); }
      .leads-table .lead-meta { color: var(--muted); font-size: 12px; }

      .lead-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
      .lead-badge.urgent { background: rgba(255, 122, 144, .18); color: #ffd4dc; border: 1px solid rgba(255, 122, 144, .5); }
      .lead-badge.normal { background: #0b182a; color: var(--muted); border: 1px solid var(--line); }
      .lead-badge.status { background: rgba(73, 209, 125, .16); color: #b7f3cf; border: 1px solid rgba(73, 209, 125, .4); }

      @media (max-width: 720px) {
        .leads-table thead { display: none; }
        .leads-table, .leads-table tbody, .leads-table tr, .leads-table td { display: block; width: 100%; }
        .leads-table tr { padding: 12px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 10px; }
        .leads-table tbody td { border: 0; padding: 4px 0; }
        .leads-table tbody tr.urgent { border-color: rgba(255, 122, 144, .5); }
      }

      .panel, .card, .step {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 24px;
        box-shadow: 0 24px 70px rgba(0,0,0,.2);
      }

      .panel { padding: 22px; margin-bottom: 18px; }
      .card, .step { padding: 18px; min-width: 0; }
      .card * { overflow-wrap: anywhere; }
      .muted { color: var(--muted); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .tiny { font-size: 12px; }

      .tenant-card {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #0d1d33, #091729);
        color: var(--ink);
        border-radius: 18px;
        padding: 15px;
      }

      .tenant-card.active { outline: 2px solid var(--brand); background: #10233a; }
      .tenant-card strong { display: block; margin-bottom: 4px; }
      .tenant-card span { display: block; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
      .tenant-group { margin-bottom: 18px; }
      .tenant-group-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin: 0 0 10px;
        color: var(--brand-2);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      .tenant-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

      .workflow {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        counter-reset: flow;
      }

      .step::before {
        counter-increment: flow;
        content: counter(flow);
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        margin-bottom: 12px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--brand), var(--brand-2));
        color: #061120;
        font-weight: 900;
      }

      .empty {
        border: 1px dashed #3a5172;
        background: rgba(19, 36, 59, .48);
        border-radius: 20px;
        padding: 22px;
        text-align: center;
      }

      .status {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: #0b182a;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
      }

      .ok { color: var(--ok); }
      .warn { color: var(--warn); }
      .danger { color: var(--danger); }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .notice {
        border: 1px solid rgba(98,168,255,.34);
        background: rgba(98,168,255,.1);
        border-radius: 16px;
        padding: 12px 14px;
        color: #d9eaff;
      }
      .notice.ok { border-color: rgba(73,209,125,.4); background: rgba(73,209,125,.1); color: #dfffe9; }
      .notice.warn { border-color: rgba(255,189,89,.42); background: rgba(255,189,89,.11); color: #ffedcb; }
      .notice.danger { border-color: rgba(255,122,144,.42); background: rgba(255,122,144,.12); color: #ffd8df; }
      .field-label { display: block; margin: 0 0 6px; color: var(--muted); font-size: 12px; font-weight: 800; }
      .helper-card { background: rgba(155,255,199,.08); border-color: rgba(155,255,199,.25); }

      .flow-section {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr);
        gap: 14px;
        align-items: start;
      }

      .flow-number {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--brand), var(--brand-2));
        color: #061120;
        font-weight: 950;
      }

      .publish-card {
        border-color: rgba(155,255,199,.52);
        background: linear-gradient(135deg, rgba(98,168,255,.13), rgba(155,255,199,.09)), var(--panel);
      }
      .publish-card .actions { align-items: stretch; }
      .publish-card button { min-width: 190px; }
      .publish-status {
        display: none;
        margin-top: 14px;
        border-radius: 16px;
        padding: 13px 14px;
        border: 1px solid rgba(73,209,125,.38);
        background: rgba(73,209,125,.1);
        color: #dfffe9;
      }
      .publish-status.warn { display: block; border-color: rgba(255,189,89,.42); background: rgba(255,189,89,.12); color: #ffedcb; }
      .publish-status.ok { display: block; }
      .publish-status.danger { display: block; border-color: rgba(255,122,144,.42); background: rgba(255,122,144,.12); color: #ffd8df; }

      .list-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        padding: 13px 0;
        border-bottom: 1px solid var(--line);
      }

      .list-row:last-child { border-bottom: 0; }
      .list-row strong, .list-row span { overflow-wrap: anywhere; }
      .source-group { margin-bottom: 18px; }
      .source-group h3 { display: flex; justify-content: space-between; gap: 12px; color: var(--brand-2); }
      .source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .source-card { border: 1px solid var(--line); background: #0b182a; border-radius: 18px; padding: 15px; }
      .source-card.primary { border-color: rgba(155,255,199,.45); background: rgba(155,255,199,.08); }
      .source-card summary { cursor: pointer; color: var(--ink); font-weight: 850; }
      .template-preview {
        margin-top: 14px;
        display: grid;
        gap: 10px;
      }
      .preview-row {
        border: 1px solid var(--line);
        background: #091729;
        border-radius: 16px;
        padding: 12px;
      }
      .preview-row strong { display: block; margin-bottom: 5px; color: var(--brand-2); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #050b14;
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
        color: #d9eaff;
      }

      @media (max-width: 980px) {
        header, .layout, .two, .cards, .workflow { display: block; }
        .nav-toggle {
          position: sticky;
          top: 10px;
          z-index: 30;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 14px;
          box-shadow: 0 14px 40px rgba(0,0,0,.28);
        }
        .nav-overlay {
          position: fixed;
          inset: 0;
          z-index: 39;
          display: block;
          background: rgba(3, 8, 16, .58);
          opacity: 0;
          pointer-events: none;
          transition: opacity .18s ease;
        }
        .sidebar {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          z-index: 40;
          width: min(88vw, 390px);
          margin: 0;
          border-radius: 0 24px 24px 0;
          overflow-y: auto;
          transform: translateX(-105%);
          transition: transform .2s ease;
        }
        body.nav-open { overflow: hidden; }
        body.nav-open .sidebar { transform: translateX(0); }
        body.nav-open .nav-overlay { opacity: 1; pointer-events: auto; }
        header { padding-bottom: 12px; }
        .panel, .card, .step { margin-bottom: 14px; }
      }

      @media (max-width: 560px) {
        header, main { padding: 20px 14px; }
        h1 { font-size: 38px; }
        .actions button { width: 100%; }
        .list-row { display: block; }
        .tenant-grid { grid-template-columns: 1fr; }
        .source-grid { grid-template-columns: 1fr; }
        .flow-section { grid-template-columns: 1fr; }
        .flow-number { width: 32px; height: 32px; }
        .publish-card { padding: 16px; }
        .publish-card button { width: 100%; min-width: 0; }
        .publish-card p, .publish-card h3 { overflow-wrap: anywhere; }
        textarea { min-height: 150px; }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <span class="pill">Estudio Conversacional AngaFlow · v1.3.1</span>
        <h1>Crea bots conversacionales desde la web de cada negocio.</h1>
        <p class="hero-copy">Selecciona una vertical, carga la URL raíz, escanea rutas corporativas y publica un flujo conversacional listo para voz, chat o WhatsApp.</p>
      </div>
      <span class="pill">Acceso: ${escapeHtml(email)}</span>
    </header>

    <main>
      <button id="navToggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="sideMenu">☰ Menú lateral</button>
      <div id="navOverlay" class="nav-overlay" aria-hidden="true"></div>

      <section class="layout">
        <aside id="sideMenu" class="panel sidebar">
          <h2>Menú</h2>
          <nav class="side-nav" aria-label="Accesos rápidos">
            <a class="side-link active" href="#create-business" data-view="create-business">Crear negocio <span>nuevo</span></a>
            <a class="side-link" href="#business-dashboard" data-view="business-dashboard">Negocios existentes <span>dashboard</span></a>
            <a class="side-link" href="#tenants-section" data-view="tenants-section">Negocio seleccionado <span>detalle</span></a>
          </nav>
        </aside>

        <div>
          <section id="create-business" class="panel app-view active">
            <h2>Crear Negocio</h2>
            <p>Completa estos datos. Al crear el negocio se genera un espacio con flujo inicial y fuente raíz lista para escanear.</p>
            <div class="two">
              <div>
                <label class="field-label" for="businessName">Nombre del negocio</label>
                <input id="businessName" type="text" autocomplete="organization" placeholder="Nombre del negocio" />
                <label class="field-label" for="newAssistantName">Nombre del asistente de voz</label>
                <input id="newAssistantName" type="text" placeholder="Ej. Ana, Lex, Asistente CBR" value="${DEFAULT_ASSISTANT_NAME}" />
                <label class="field-label" for="newVoiceNumber">Número de voz / Twilio</label>
                <input id="newVoiceNumber" type="tel" inputmode="tel" placeholder="${DEFAULT_VOICE_NUMBER}" value="${DEFAULT_VOICE_NUMBER}" />
                <label class="field-label" for="vertical">Vertical</label>
                <select id="vertical">${verticalOptions()}</select>
                <label class="field-label" for="website">Sitio web principal</label>
                <input id="website" type="url" inputmode="url" placeholder="https://www.negocio.mx" />
                <div class="actions"><button id="createTenant" type="button">Crear negocio</button></div>
                <p id="createResult" class="notice" role="status" style="display:none;"></p>
              </div>
              <div class="card helper-card">
                <h3>Después de crear</h3>
                <p>Te llevaré automáticamente al detalle del negocio para escanear su sitio y configurar el flujo conversacional.</p>
              </div>
            </div>
          </section>

          <section id="business-dashboard" class="panel app-view">
            <h2>Negocios Existentes</h2>
            <p>Panel de negocios creados. Selecciona uno para abrir su detalle, escanear conocimiento y configurar el flujo.</p>
            <div id="businessDashboard" class="stack"></div>
          </section>

          <section id="tenants-section" class="panel app-view">
            <h2>Negocio Seleccionado</h2>
            <p>Detalle operativo del negocio. Aquí editas datos base, escaneas conocimiento y publicas el flujo.</p>
            <div class="accordion">
              <section id="tenant-data-section" class="panel accordion-section open" data-accordion="tenant-data">
                <h3 class="accordion-heading">
                  <button id="tenant-data-toggle" class="accordion-toggle" type="button" aria-expanded="true" aria-controls="tenant-data-body">
                    Datos del negocio <span>negocio, asistente y número</span>
                  </button>
                </h3>
                <div id="tenant-data-body" class="accordion-body" role="region" aria-labelledby="tenant-data-toggle">
                  <div class="two">
                    <div>
                      <p class="muted tiny">Edita solo lo necesario. Guardar el negocio no publica cambios en el flujo.</p>
                      <label class="field-label" for="tenantName">Nombre</label>
                      <input id="tenantName" type="text" autocomplete="organization" placeholder="Selecciona un negocio" />
                      <label class="field-label" for="tenantVertical">Vertical</label>
                      <select id="tenantVertical">${verticalOptions()}</select>
                      <label class="field-label" for="tenantWebsite">Sitio web principal</label>
                      <input id="tenantWebsite" type="url" inputmode="url" placeholder="https://www.negocio.mx" />
                      <label class="field-label" for="tenantAssistantName">Nombre del asistente de voz</label>
                      <input id="tenantAssistantName" type="text" placeholder="Ej. Ana, Lex, Asistente CBR" />
                      <label class="field-label" for="tenantVoiceNumber">Número de voz / Twilio</label>
                      <input id="tenantVoiceNumber" type="tel" inputmode="tel" placeholder="${DEFAULT_VOICE_NUMBER}" />
                      <div class="actions">
                        <button id="updateTenant" class="secondary" type="button">Guardar negocio</button>
                        <button id="deleteTenant" class="danger" type="button">Borrar negocio</button>
                      </div>
                      <p id="tenantResult" class="notice" role="status" style="display:none;"></p>
                    </div>
                    <div class="card helper-card">
                      <h4>Cómo trabajar este negocio</h4>
                      <p>Primero guarda datos base, después escanea el sitio, revisa servicios detectados, carga una plantilla al editor y finalmente publica al Worker.</p>
                    </div>
                  </div>
                </div>
              </section>

              <section id="knowledge-scan" class="panel accordion-section open" data-accordion="knowledge-scan">
                <h3 class="accordion-heading">
                  <button id="knowledge-scan-toggle" class="accordion-toggle" type="button" aria-expanded="true" aria-controls="knowledge-scan-body">
                    Escaneo de Conocimiento <span>sitio y fuentes</span>
                  </button>
                </h3>
                <div id="knowledge-scan-body" class="accordion-body" role="region" aria-labelledby="knowledge-scan-toggle">
                  <p>Agrega una URL específica o escanea el sitio para descubrir páginas relevantes. Si el scan encuentra nuevas fuentes, vuelve a escanear para procesarlas.</p>
                  <label class="field-label" for="sourceUrl">URL adicional opcional</label>
                  <input id="sourceUrl" type="url" inputmode="url" placeholder="https://www.negocio.mx/servicios/..." />
                  <div class="actions">
                    <button id="addSource" class="secondary" type="button">Agregar fuente</button>
                    <button id="scan" type="button">Escanear sitio</button>
                  </div>
                  <p id="actionResult" class="notice" role="status" style="display:none;"></p>
                </div>
              </section>

              <section id="services-section" class="panel accordion-section" data-accordion="services">
                <h3 class="accordion-heading">
                  <button id="services-toggle" class="accordion-toggle" type="button" aria-expanded="false" aria-controls="services-body">
                    Servicios Detectados <span>oferta consultiva</span>
                  </button>
                </h3>
                <div id="services-body" class="accordion-body" role="region" aria-labelledby="services-toggle">
                  <div id="services" class="cards"></div>
                </div>
              </section>

              <section id="sources-section" class="panel accordion-section" data-accordion="sources">
                <h3 class="accordion-heading">
                  <button id="sources-toggle" class="accordion-toggle" type="button" aria-expanded="false" aria-controls="sources-body">
                    Fuentes de Conocimiento <span>páginas escaneadas</span>
                  </button>
                </h3>
                <div id="sources-body" class="accordion-body" role="region" aria-labelledby="sources-toggle">
                  <div id="sources"></div>
                </div>
              </section>

              <section id="flow-config" class="panel accordion-section open" data-accordion="flow">
                <h3 class="accordion-heading">
                  <button id="flow-toggle" class="accordion-toggle" type="button" aria-expanded="true" aria-controls="flow-body">
                    Flujo Conversacional <span>guion y publicación</span>
                  </button>
                </h3>
                <div id="flow-body" class="accordion-body" role="region" aria-labelledby="flow-toggle">
                  <p>Escoge una plantilla, revísala completa, úsala en el editor y publica solo cuando el flujo se vea correcto.</p>
                  <div class="card flow-section">
                    <span class="flow-number" aria-hidden="true">1</span>
                    <div>
                      <h4>Elegir plantilla base</h4>
                      <p>Selecciona un escenario para previsualizar saludo, preguntas y cierre antes de tocar el asistente.</p>
                      <label class="field-label" for="flowTemplate">Plantilla</label>
                      <select id="flowTemplate"></select>
                      <p id="templateDescription" class="muted tiny"></p>
                      <div id="templatePreview" class="template-preview"></div>
                      <div class="actions"><button id="applyTemplate" type="button">Cargar plantilla al editor</button></div>
                    </div>
                  </div>
                  <p id="flowResult" class="muted tiny" role="status"></p>
                  <div id="flow"></div>
                </div>
              </section>

              <section id="leads-section" class="panel accordion-section" data-accordion="leads">
                <h3 class="accordion-heading">
                  <button id="leads-toggle" class="accordion-toggle" type="button" aria-expanded="false" aria-controls="leads-body">
                    Prospectos Confirmados <span id="leadsCounter">seguimiento</span>
                  </button>
                </h3>
                <div id="leads-body" class="accordion-body" role="region" aria-labelledby="leads-toggle">
                  <div class="leads-toolbar" role="group" aria-label="Filtrar prospectos">
                    <button type="button" class="lead-filter active" data-filter="all">Todos</button>
                    <button type="button" class="lead-filter" data-filter="urgent">Urgentes</button>
                    <button type="button" class="lead-filter" data-filter="normal">Normales</button>
                  </div>
                  <div id="leads"></div>
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>
    </main>

    <script>
      const DEFAULT_ASSISTANT_NAME = '${DEFAULT_ASSISTANT_NAME}';
      const DEFAULT_VOICE_NUMBER = '${DEFAULT_VOICE_NUMBER}';
      const SCAN_PAGE_LIMIT = 40;
      const state = { tenantId: null, tenants: [], templates: [], lastPublish: null, leads: [], leadsFilter: 'all', leadsAutoOpened: false };
      const $ = (id) => document.getElementById(id);
      const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
      const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => HTML_ENTITIES[char] ?? char);
      const setNavOpen = (open) => {
        document.body.classList.toggle('nav-open', open);
        $('navToggle')?.setAttribute('aria-expanded', String(open));
      };
      const switchView = (viewId) => {
        document.querySelectorAll('.app-view').forEach(view => view.classList.toggle('active', view.id === viewId));
        document.querySelectorAll('.side-link').forEach(link => link.classList.toggle('active', link.dataset.view === viewId));
        document.body.classList.toggle('view-tenant-detail', viewId === 'tenants-section');
        setNavOpen(false);
        history.replaceState(null, '', '#' + viewId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      const api = async (path, options) => {
        const res = await fetch('/api/admin/' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      };
      const hasTenant = () => Boolean(state.tenantId);
      const setActions = () => {
        ['addSource','scan','applyTemplate','saveFlowMessages','publishFlowEditor','updateTenant','deleteTenant'].forEach(id => { const el = $(id); if (el) el.disabled = !hasTenant(); });
      };
      const empty = (title, body) => '<div class="empty"><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>';
      const showNotice = (id, message, tone = 'ok') => {
        const el = $(id);
        if (!el) return;
        el.style.display = 'block';
        el.className = 'notice ' + tone;
        el.textContent = message;
      };
      const showNoticeHtml = (id, html, tone = 'ok') => {
        const el = $(id);
        if (!el) return;
        el.style.display = 'block';
        el.className = 'notice ' + tone;
        el.innerHTML = html;
      };
      const setBusy = (id, busy, label) => {
        const el = $(id);
        if (!el) return;
        if (!el.dataset.label) el.dataset.label = el.textContent;
        el.disabled = busy || (!hasTenant() && id !== 'createTenant');
        el.textContent = busy ? label : el.dataset.label;
      };
      const scanMessage = (result) => {
        const base = 'Escaneo listo: ' + result.scanned + ' páginas procesadas, ' + result.discovered + ' fuentes internas descubiertas, ' + result.failed + ' errores.';
        return result.scanned >= SCAN_PAGE_LIMIT ? base + ' Se alcanzó el límite seguro por corrida; si faltan páginas, ejecuta Escanear sitio otra vez.' : base + ' Siguiente paso: revisa Servicios Detectados y Flujo Conversacional.';
      };
      const renderPublishStatus = (result, tone = 'ok') => {
        const el = $('publishStatus');
        if (!el || !result) return;
        el.className = 'publish-status ' + tone;
        if (tone === 'ok') {
          el.innerHTML = '<strong>Publicado correctamente.</strong><br>Asistente de voz: '+esc(result.assistantName || DEFAULT_ASSISTANT_NAME)+'<br>Número: '+esc(result.voiceNumber || 'sin número asignado')+'<br>Versión: '+esc(result.version)+'<br>Hora: '+esc(new Date(result.publishedAt).toLocaleString('es-MX'));
        } else {
          el.textContent = result;
        }
      };

      async function load() {
        if (!state.templates.length) {
          const templateData = await api('flow-templates');
          state.templates = templateData.templates || [];
        }
        const data = await api('tenants');
        state.tenants = data.tenants;
        if (!state.tenants.length) {
          state.tenantId = null;
          $('businessDashboard').innerHTML = empty('Sin negocios todavía', 'Crea tu primer negocio para iniciar el escaneo y generar un flujo conversacional.');
          renderTenantEditor();
          clearWorkspace();
          setActions();
          return;
        }
        const stillExists = state.tenants.some(t => t.id === state.tenantId);
        if (!stillExists) state.tenantId = state.tenants[0].id;
        renderBusinessDashboard();
        renderTenantEditor();
        renderTemplatePicker();
        setActions();
        bindAccordions();
        await Promise.all([loadServices(), loadSources(), loadFlow(), loadLeads()]);
      }

      function bindAccordions() {
        document.querySelectorAll('.accordion-toggle').forEach(button => {
          if (button.dataset.bound === 'true') return;
          button.dataset.bound = 'true';
          button.addEventListener('click', () => {
            const section = button.closest('.accordion-section');
            if (!section) return;
            const open = section.classList.toggle('open');
            button.setAttribute('aria-expanded', String(open));
          });
        });
      }

      function renderBusinessDashboard() {
        const groups = state.tenants.reduce((acc, tenant) => {
          const vertical = tenant.vertical || 'Sin vertical';
          acc[vertical] = acc[vertical] || [];
          acc[vertical].push(tenant);
          return acc;
        }, {});
        const renderCard = (tenant) => [
          '<button type="button" class="tenant-card'+(tenant.id === state.tenantId ? ' active' : '')+'"',
          ' data-id="'+esc(tenant.id)+'"',
          ' aria-current="'+(tenant.id === state.tenantId ? 'true' : 'false')+'">',
          '<strong>'+esc(tenant.name)+'</strong>',
          '<span>'+esc(tenant.status || 'activo')+' · '+esc(tenant.country || 'MX')+'</span>',
          '<span>'+esc(tenant.voice_number ? 'Voz: ' + tenant.voice_number : 'Sin número de voz')+'</span>',
          '<span>'+esc(tenant.website || 'Sin URL')+'</span>',
          '<span class="status">Abrir negocio</span>',
          '</button>'
        ].join('');

        const renderGroup = ([vertical, tenants]) => [
          '<div class="tenant-group">',
          '<div class="tenant-group-title"><strong>'+esc(vertical)+'</strong>',
          '<span>'+esc(tenants.length)+' negocio'+(tenants.length === 1 ? '' : 's')+'</span></div>',
          '<div class="tenant-grid">'+tenants.map(renderCard).join('')+'</div>',
          '</div>'
        ].join('');

        $('businessDashboard').innerHTML = Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b, 'es'))
          .map(renderGroup)
          .join('');
        document.querySelectorAll('.tenant-card').forEach(button => {
          button.addEventListener('click', async () => {
            state.tenantId = button.dataset.id;
            state.leadsAutoOpened = false;
            renderBusinessDashboard();
            renderTenantEditor();
            renderTemplatePicker();
            await Promise.all([loadServices(), loadSources(), loadFlow(), loadLeads()]);
            switchView('tenants-section');
          });
        });
      }

      function currentTenant() {
        return state.tenants.find(t => t.id === state.tenantId);
      }

      function renderTenantEditor() {
        const tenant = currentTenant();
        $('tenantName').value = tenant?.name || '';
        $('tenantVertical').value = tenant?.vertical || 'General / Conversacional';
        $('tenantWebsite').value = tenant?.website || '';
        $('tenantVoiceNumber').value = tenant?.voice_number || '';
        if ($('tenantAssistantName')) $('tenantAssistantName').value = tenant ? DEFAULT_ASSISTANT_NAME : '';
        ['tenantName','tenantVertical','tenantWebsite','tenantAssistantName','tenantVoiceNumber'].forEach(id => $(id).disabled = !tenant);
        showNotice('tenantResult', tenant ? 'Seleccionado: ' + tenant.name + '. Puedes editarlo, escanear conocimiento o configurar su flujo.' : 'Selecciona un negocio para modificarlo.', tenant ? 'ok' : 'warn');
      }

      function templatesForCurrentTenant() {
        const tenant = currentTenant();
        const vertical = tenant?.vertical;
        const exact = state.templates.filter(t => t.vertical === vertical);
        const general = state.templates.filter(t => t.vertical === 'General / Conversacional');
        return exact.length ? exact.concat(general) : general;
      }

      function renderTemplatePicker() {
        const templates = templatesForCurrentTenant();
        $('flowTemplate').innerHTML = templates.map(t => '<option value="'+esc(t.id)+'">'+esc(t.vertical)+' · '+esc(t.level)+' · '+esc(t.name)+'</option>').join('');
        updateTemplateDescription();
      }

      function updateTemplateDescription() {
        const template = state.templates.find(t => t.id === $('flowTemplate').value);
        $('templateDescription').textContent = template ? template.description : 'Sin plantilla disponible para esta vertical.';
        $('templatePreview').innerHTML = template ? renderTemplatePreview(template) : '';
      }

      function renderTemplatePreview(template) {
        return [
          ['Saludo', template.greeting],
          ['Pregunta 1', template.steps?.[0]?.prompt || ''],
          ['Pregunta 2', template.steps?.[1]?.prompt || ''],
          ['Pregunta 3', template.steps?.[2]?.prompt || ''],
          ['Confirmación', template.confirmationTemplate],
          ['Cierre', template.completionMessage],
          ['Fallback', template.fallbackMessage]
        ].filter(([, value]) => value).map(([label, value]) => '<div class="preview-row"><strong>'+esc(label)+'</strong><span>'+esc(value)+'</span></div>').join('');
      }

      // Limpieza genérica de ruido de scraping. No debe contener texto de un tenant concreto.
      function cleanSourcePreview(value) {
        return String(value || '')
          .replace(/^-->\s*/, '')
          .replace(/\bLoading\.\.\.\s*/gi, '')
          .replace(/^top of page\s*/i, '')
          .replace(/^skip to (?:main )?content\s*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }

      const SOURCE_CATEGORIES = [
        { label: 'Oferta / Áreas vendibles', test: /areas?-de-practica|áreas?-de-práctica|practica|práctica|servicio|service|solution|producto|product|catalogo|catálogo/ },
        { label: 'Contacto y conversión', test: /contacto|contact|cotiza|quote|demo|agenda/ },
        { label: 'Institucional', test: /quienes-somos|nosotros|about|firma|empresa|company|experiencia/ },
        { label: 'Equipo y credenciales', test: /nuestro-equipo|equipo|team|staff|certificac|reconocimiento/ },
      ];
      const FALLBACK_CATEGORY = 'Otras fuentes útiles';

      function sourceCategory(source) {
        const value = ((source.url || '') + ' ' + (source.title || '')).toLowerCase();
        return SOURCE_CATEGORIES.find(entry => entry.test.test(value))?.label || FALLBACK_CATEGORY;
      }

      function sourceRank(category) {
        const index = SOURCE_CATEGORIES.findIndex(entry => entry.label === category);
        return index === -1 ? SOURCE_CATEGORIES.length : index;
      }

      function renderSourceCard(source, primary = false) {
        return '<article class="source-card '+(primary ? 'primary' : '')+'"><span class="status '+(source.status === 'scanned' ? 'ok' : source.status === 'error' ? 'danger' : 'warn')+'">'+esc(source.status)+'</span><h3>'+esc(source.title || source.url)+'</h3><p>'+esc(cleanSourcePreview(source.summary).slice(0, 220))+'</p><p class="mono tiny muted">'+esc(source.url)+'</p></article>';
      }

      function renderSourceGroups(sources) {
        const groups = sources.reduce((acc, source) => {
          const category = sourceCategory(source);
          acc[category] = acc[category] || [];
          acc[category].push(source);
          return acc;
        }, {});

        return Object.entries(groups).sort(([a], [b]) => sourceRank(a) - sourceRank(b)).map(([category, items]) => {
          const primary = category === 'Oferta / Áreas vendibles';
          if (category === 'Equipo y credenciales') {
            const lead = items.find(source => /nuestro-equipo\/?$/i.test(source.url)) || items[0];
            const hidden = items.filter(source => source !== lead);
            return '<section class="source-group"><h3>'+esc(category)+' <span class="status">'+esc(items.length)+' fuentes</span></h3><div class="source-grid">'+renderSourceCard(lead, false)+'</div>'+(hidden.length ? '<details class="source-card"><summary>Ver '+esc(hidden.length)+' perfiles escaneados</summary>'+hidden.map(source => '<p class="mono tiny muted">'+esc(source.url)+'</p>').join('')+'</details>' : '')+'</section>';
          }
          return '<section class="source-group"><h3>'+esc(category)+' <span class="status">'+esc(items.length)+' fuentes</span></h3><div class="source-grid">'+items.map(source => renderSourceCard(source, primary)).join('')+'</div></section>';
        }).join('');
      }

      function clearWorkspace() {
        $('services').innerHTML = empty('Sin servicios', 'Los servicios aparecerán después de escanear el sitio del negocio.');
        $('sources').innerHTML = empty('Sin fuentes', 'La URL raíz y las rutas descubiertas aparecerán aquí.');
        $('flow').innerHTML = empty('Sin flujo', 'Al crear el negocio se genera un borrador inicial.');
        $('flowTemplate').innerHTML = '';
        $('templateDescription').textContent = '';
        $('leads').innerHTML = empty(
          'Sin prospectos',
          'Los prospectos confirmados aparecerán cuando el agente empiece a operar. Llama al ' + DEFAULT_VOICE_NUMBER + ' para generar el primero.',
        );
      }

      async function loadServices() {
        const data = await api('tenants/' + state.tenantId + '/services');
        $('services').innerHTML = data.services.length ? data.services.map(s => '<article class="card"><span class="status">Prioridad '+esc(s.priority)+'</span><h3>'+esc(s.name)+'</h3><p>'+esc(s.description)+'</p><p class="mono tiny muted">'+esc(s.source_url || 'Fuente pendiente')+'</p></article>').join('') : empty('Sin servicios detectados', 'Ejecuta el escaneo para convertir páginas de servicios o productos en tarjetas editables.');
      }

      async function loadSources() {
        const data = await api('tenants/' + state.tenantId + '/sources');
        $('sources').innerHTML = data.sources.length ? renderSourceGroups(data.sources) : empty('Sin fuentes', 'Agrega una URL raíz o una página específica para iniciar.');
      }

      async function loadFlow() {
        const data = await api('tenants/' + state.tenantId + '/flow');
        if (!data.flow) { $('flow').innerHTML = empty('Sin flujo', 'Crea un negocio para generar el flujo inicial.'); return; }
        const flowSettings = safeJson(data.flow.settings || '{}');
        if ($('tenantAssistantName')) $('tenantAssistantName').value = flowSettings.assistant_name || DEFAULT_ASSISTANT_NAME;
        const customFlow = {
          assistantName: flowSettings.assistant_name || DEFAULT_ASSISTANT_NAME,
          name: 'Flow custom',
          description: 'Flow configurado manualmente desde Studio.',
          greeting: data.flow.greeting,
          confirmationTemplate: data.flow.confirmation_template,
          completionMessage: data.flow.completion_message,
          fallbackMessage: data.flow.fallback_message,
          speechHints: JSON.parse(data.flow.speech_hints || '[]'),
          steps: data.steps.map(s => ({ slotKey: s.slot_key, prompt: s.prompt, retryPrompt: s.retry_prompt || undefined }))
        };
        $('flow').innerHTML = [
          '<div class="stack"><div class="card flow-section">',
          '<span class="flow-number" aria-hidden="true">2</span>',
          '<div>',
          '<span class="status">'+esc(data.flow.status)+' · v'+esc(data.flow.version)+'</span>',
          '<h4>Editor del asistente</h4>',
          '<p>Este es el guion real que escuchará el usuario: saludo, preguntas, confirmación, cierre y recuperación.</p>',
          '<label class="tiny muted" for="flowGreeting">Saludo inicial</label><textarea id="flowGreeting"></textarea>',
          '<h4>Preguntas en orden</h4><div id="flowStepsEditor" class="stack"></div>',
          '<label class="tiny muted" for="flowConfirmation">Confirmación antes de guardar lead</label><textarea id="flowConfirmation"></textarea>',
          '<label class="tiny muted" for="flowCompletion">Mensaje final</label><textarea id="flowCompletion"></textarea>',
          '<label class="tiny muted" for="flowFallback">Si no entiende al usuario</label><textarea id="flowFallback"></textarea>',
          '<label class="tiny muted" for="flowHints">Palabras clave para reconocer voz, separadas por coma</label><input id="flowHints" type="text" />',
          '<div class="actions"><button id="saveFlowMessages" type="button">Guardar borrador</button><button id="publishFlowEditor" type="button">Publicar al Worker</button></div>',
          '<div id="publishStatus" class="publish-status" role="status"></div>',
          '</div></div></div>'
        ].join('');
        $('flowGreeting').value = customFlow.greeting;
        $('flowConfirmation').value = customFlow.confirmationTemplate;
        $('flowCompletion').value = customFlow.completionMessage;
        $('flowFallback').value = customFlow.fallbackMessage;
        $('flowHints').value = customFlow.speechHints.join(', ');
        $('flowStepsEditor').innerHTML = customFlow.steps.map((step, index) => {
          const fieldId = 'flowStep-' + esc(step.slotKey);
          return '<div class="card"><label class="tiny muted" for="'+fieldId+'">Paso '+esc(index + 1)+' · '+esc(labelForSlot(step.slotKey))+'</label><textarea id="'+fieldId+'" class="flow-step-prompt" data-slot="'+esc(step.slotKey)+'"></textarea></div>';
        }).join('');
        document.querySelectorAll('.flow-step-prompt').forEach((field, index) => { field.value = customFlow.steps[index].prompt; });
        $('saveFlowMessages').addEventListener('click', () => saveEditorFlow('Borrador guardado. Cuando se vea correcto, presiona Publicar al Worker.'));
        $('publishFlowEditor').addEventListener('click', publishFlow);
        if (state.lastPublish?.tenantId === state.tenantId) {
          renderPublishStatus(state.lastPublish.result, 'ok');
        }
        setActions();
      }

      function flowFromEditor() {
        const assistantName = $('tenantAssistantName')?.value.trim() || DEFAULT_ASSISTANT_NAME;
        return {
          assistantName,
          name: 'Flow editado desde Studio',
          description: 'Flow actualizado desde el editor rápido de AngaFlow Studio.',
          greeting: syncAssistantName($('flowGreeting').value.trim(), assistantName),
          confirmationTemplate: $('flowConfirmation').value.trim(),
          completionMessage: $('flowCompletion').value.trim(),
          fallbackMessage: $('flowFallback').value.trim(),
          speechHints: $('flowHints').value.split(',').map(v => v.trim()).filter(Boolean),
          steps: Array.from(document.querySelectorAll('.flow-step-prompt')).map(field => ({ slotKey: field.dataset.slot, prompt: field.value.trim() })).filter(step => step.prompt)
        };
      }

      function labelForSlot(slot) {
        return ({ nombre_cliente: 'Nombre del cliente', motivo: 'Motivo o necesidad', fecha_hora: 'Fecha y hora', telefono: 'Teléfono' })[slot] || slot;
      }

      function safeJson(value) {
        try { return JSON.parse(value); } catch { return {}; }
      }

      function syncAssistantName(greeting, assistantName) {
        if (!assistantName) return greeting;
        if (/\bSoy\s+[^.¿?]+[.¿?]/i.test(greeting)) {
          return greeting.replace(/\bSoy\s+[^.¿?]+([.¿?])/i, 'Soy ' + assistantName + '$1');
        }
        return greeting.replace(/(Gracias por (?:llamar|comunicarte|contactar)[^.]+\.)/i, '$1 Soy ' + assistantName + '.');
      }

      async function saveEditorFlow(message) {
        if (!hasTenant()) return;
        showNotice('flowResult', 'Guardando borrador...', 'warn');
        const r = await api('tenants/' + state.tenantId + '/flow', { method:'POST', body: JSON.stringify({ customFlow: flowFromEditor() }) });
        showNotice('flowResult', message, 'ok');
        await loadFlow();
        return r;
      }

      async function publishFlow() {
        if (!hasTenant()) return;
        const button = $('publishFlowEditor');
        if (button) button.disabled = true;
        showNotice('flowResult', 'Publicando borrador al Worker...', 'warn');
        renderPublishStatus('Publicando borrador al Worker...', 'warn');
        try {
          await api('tenants/' + state.tenantId + '/flow', { method:'POST', body: JSON.stringify({ customFlow: flowFromEditor() }) });
          const r = await api('tenants/' + state.tenantId + '/publish', { method:'POST', body:'{}' });
          state.lastPublish = { tenantId: state.tenantId, result: r };
          if (!r.ok) throw new Error('El Worker no confirmó que el flow quedó activo.');
          showNoticeHtml('flowResult', '<strong>Publicado al Worker.</strong> Guardé tus cambios y activé la versión '+esc(r.version)+'.', 'ok');
          await loadFlow();
          renderPublishStatus(r, 'ok');
        } catch (error) {
          showNoticeHtml('flowResult', '<strong>No se pudo publicar.</strong> '+esc(error.message || error), 'danger');
          renderPublishStatus('No se pudo publicar: ' + (error.message || error), 'danger');
        } finally {
          const nextButton = $('publishFlowEditor');
          if (nextButton) nextButton.disabled = !hasTenant();
        }
      }

      async function applySelectedTemplate() {
        if (!hasTenant()) return;
        setBusy('applyTemplate', true, 'Cargando...');
        showNotice('flowResult', 'Cargando plantilla en el editor...', 'warn');
        try {
          await api('tenants/' + state.tenantId + '/flow', { method:'POST', body: JSON.stringify({ templateId: $('flowTemplate').value, assistantName: $('tenantAssistantName')?.value.trim() || DEFAULT_ASSISTANT_NAME }) });
          await loadFlow();
          showNoticeHtml('flowResult', '<strong>Plantilla cargada en editor.</strong> Revisa o ajusta los textos y luego presiona Publicar al Worker.', 'ok');
        } catch (error) {
          showNoticeHtml('flowResult', '<strong>No se pudo cargar la plantilla.</strong> '+esc(error.message || error), 'danger');
        } finally {
          setBusy('applyTemplate', false);
        }
      }

      async function loadLeads() {
        const data = await api('tenants/' + state.tenantId + '/leads');
        state.leads = (data.leads || []).map(normalizeLead);
        state.leadsFilter = state.leadsFilter || 'all';
        renderLeadsCounter();
        renderLeadsBody();
        bindLeadFilters();
        maybeAutoOpenLeads();
      }

      function normalizeLead(lead) {
        let meta = {};
        try { meta = JSON.parse(lead.metadata || '{}'); } catch { meta = {}; }
        return {
          id: lead.id,
          name: lead.name || 'Sin nombre',
          phone: lead.phone || '',
          service: lead.service || 'Sin servicio',
          requestedAt: lead.requested_at || '',
          status: lead.status || 'confirmed',
          createdAt: lead.created_at,
          urgent: Number(lead.urgent) === 1,
          urgencyPhrase: meta && typeof meta.urgencyPhrase === 'string' ? meta.urgencyPhrase : null,
        };
      }

      function renderLeadsCounter() {
        const urgent = state.leads.filter(l => l.urgent).length;
        const total = state.leads.length;
        const counter = $('leadsCounter');
        if (!counter) return;
        if (!total) { counter.textContent = 'seguimiento'; return; }
        const totalLabel = total + ' prospecto' + (total === 1 ? '' : 's');
        if (urgent === 0) { counter.textContent = totalLabel; return; }
        counter.innerHTML = esc(totalLabel) + ' · <span class="lead-counter-urgent">' + esc(urgent) + ' urgente' + (urgent === 1 ? '' : 's') + '</span>';
      }

      function filteredLeads() {
        if (state.leadsFilter === 'urgent') return state.leads.filter(l => l.urgent);
        if (state.leadsFilter === 'normal') return state.leads.filter(l => !l.urgent);
        return state.leads;
      }

      function renderLeadsBody() {
        const container = $('leads');
        if (!container) return;
        const leads = filteredLeads();
        if (!state.leads.length) {
          container.innerHTML = empty(
            'Sin prospectos confirmados',
            'Haz una llamada de prueba al ' + DEFAULT_VOICE_NUMBER + ' para generar el primer prospecto. Los urgentes aparecerán marcados en rojo.',
          );
          return;
        }
        if (!leads.length) {
          container.innerHTML = empty(
            state.leadsFilter === 'urgent' ? 'Sin prospectos urgentes' : 'Sin prospectos normales',
            'Cambia el filtro para ver el resto.',
          );
          return;
        }
        const rows = leads.map(lead => {
          const badge = lead.urgent
            ? '<span class="lead-badge urgent" title="'+esc(lead.urgencyPhrase || 'Marcado como urgente')+'">Urgente</span>'
            : '<span class="lead-badge normal">Normal</span>';
          return [
            '<tr class="'+(lead.urgent ? 'urgent' : '')+'">',
              '<td>'+badge+'</td>',
              '<td><div class="lead-name">'+esc(lead.name)+'</div><div class="lead-meta">'+esc(formatCreatedAt(lead.createdAt))+'</div></td>',
              '<td><div class="lead-phone">'+esc(lead.phone || '—')+'</div></td>',
              '<td><div class="lead-service">'+esc(lead.service)+'</div>'+(lead.requestedAt ? '<div class="lead-meta">Cita: '+esc(lead.requestedAt)+'</div>' : '')+'</td>',
              '<td><span class="lead-badge status">'+esc(lead.status)+'</span></td>',
            '</tr>'
          ].join('');
        }).join('');
        container.innerHTML = [
          '<table class="leads-table" aria-label="Prospectos confirmados">',
            '<thead><tr><th>Prioridad</th><th>Prospecto</th><th>Teléfono</th><th>Servicio</th><th>Status</th></tr></thead>',
            '<tbody>'+rows+'</tbody>',
          '</table>'
        ].join('');
      }

      function bindLeadFilters() {
        document.querySelectorAll('.lead-filter').forEach(button => {
          if (button.dataset.bound === 'true') return;
          button.dataset.bound = 'true';
          button.addEventListener('click', () => {
            state.leadsFilter = button.dataset.filter;
            document.querySelectorAll('.lead-filter').forEach(btn => btn.classList.toggle('active', btn === button));
            renderLeadsBody();
          });
        });
      }

      function maybeAutoOpenLeads() {
        if (state.leadsAutoOpened) return;
        const hasUrgent = state.leads.some(l => l.urgent);
        if (!hasUrgent) return;
        const section = $('leads-section');
        const toggle = $('leads-toggle');
        if (!section || !toggle) return;
        section.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        state.leadsAutoOpened = true;
      }

      function formatCreatedAt(epochSeconds) {
        if (!epochSeconds) return '';
        const ms = Number(epochSeconds) * 1000;
        if (!Number.isFinite(ms)) return '';
        try { return new Date(ms).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); }
        catch { return ''; }
      }

      $('createTenant').addEventListener('click', async () => {
        setBusy('createTenant', true, 'Creando...');
        const payload = { name: $('businessName').value.trim(), assistantName: $('newAssistantName').value.trim(), voiceNumber: $('newVoiceNumber').value.trim(), vertical: $('vertical').value, website: $('website').value.trim() };
        try {
          const result = await api('tenants', { method: 'POST', body: JSON.stringify(payload) });
          showNotice('createResult', 'Negocio creado. Te llevo a su detalle para escanear el sitio y configurar el flujo.', 'ok');
          $('businessName').value = '';
          $('newAssistantName').value = DEFAULT_ASSISTANT_NAME;
          $('newVoiceNumber').value = DEFAULT_VOICE_NUMBER;
          $('website').value = '';
          state.tenantId = result.tenantId;
          await load();
          switchView('tenants-section');
        } catch (error) {
          showNotice('createResult', 'No se pudo crear el negocio: ' + (error.message || error), 'danger');
        } finally {
          setBusy('createTenant', false);
        }
      });

      $('updateTenant').addEventListener('click', async () => {
        if (!hasTenant()) return;
        setBusy('updateTenant', true, 'Guardando...');
        showNotice('tenantResult', 'Guardando negocio...', 'warn');
        const payload = { name: $('tenantName').value.trim(), vertical: $('tenantVertical').value, website: $('tenantWebsite').value.trim(), voiceNumber: $('tenantVoiceNumber').value.trim() };
        try {
          await api('tenants/' + state.tenantId, { method: 'PATCH', body: JSON.stringify(payload) });
          if ($('flowGreeting')) {
            await api('tenants/' + state.tenantId + '/flow', { method:'POST', body: JSON.stringify({ customFlow: flowFromEditor() }) });
          }
          showNotice('tenantResult', 'Negocio actualizado. Nombre del asistente guardado como borrador. Publica el flujo para llevarlo a producción.', 'ok');
          await load();
        } catch (error) {
          showNotice('tenantResult', 'No se pudo actualizar: ' + (error.message || error), 'danger');
        } finally {
          setBusy('updateTenant', false);
        }
      });

      $('deleteTenant').addEventListener('click', async () => {
        if (!hasTenant()) return;
        const tenant = currentTenant();
        if (!tenant) return;
        if (!confirm('¿Borrar el negocio "' + tenant.name + '" y todos sus flujos, fuentes, servicios y prospectos?')) return;
        setBusy('deleteTenant', true, 'Borrando...');
        showNotice('tenantResult', 'Borrando negocio...', 'warn');
        const deletedId = state.tenantId;
        try {
          await api('tenants/' + deletedId, { method: 'DELETE' });
          showNotice('tenantResult', 'Negocio borrado.', 'ok');
          state.tenantId = null;
          await load();
        } catch (error) {
          showNotice('tenantResult', 'No se pudo borrar: ' + (error.message || error), 'danger');
        } finally {
          setBusy('deleteTenant', false);
        }
      });

      bindAccordions();
      $('navToggle').addEventListener('click', () => setNavOpen(!document.body.classList.contains('nav-open')));
      $('navOverlay').addEventListener('click', () => setNavOpen(false));
      document.querySelectorAll('.side-link').forEach(link => link.addEventListener('click', (event) => { event.preventDefault(); switchView(link.dataset.view); }));
      if (['create-business','tenants-section'].includes(location.hash.slice(1))) {
        switchView(location.hash.slice(1));
      } else {
        switchView('create-business');
      }
      $('addSource').addEventListener('click', async () => {
        if (!hasTenant()) return;
        const url = $('sourceUrl').value.trim();
        if (!url) {
          showNotice('actionResult', 'Escribe una URL antes de agregar la fuente.', 'warn');
          return;
        }
        setBusy('addSource', true, 'Agregando...');
        try {
          await api('tenants/' + state.tenantId + '/sources', { method: 'POST', body: JSON.stringify({ url }) });
          showNotice('actionResult', 'Fuente agregada. Ahora presiona Escanear sitio para procesarla.', 'ok');
          $('sourceUrl').value = '';
          await loadSources();
        } catch (error) {
          showNotice('actionResult', 'No se pudo agregar la fuente: ' + (error.message || error), 'danger');
        } finally {
          setBusy('addSource', false);
        }
      });

      $('scan').addEventListener('click', async () => {
        if (!hasTenant()) return;
        setBusy('scan', true, 'Escaneando...');
        showNotice('actionResult', 'Escaneando sitio y rutas corporativas...', 'warn');
        try {
          const result = await api('tenants/' + state.tenantId + '/scan', { method: 'POST', body: '{}' });
          showNotice('actionResult', scanMessage(result) + ' También generé un borrador de flujo más inteligente con los servicios detectados.', result.failed ? 'warn' : 'ok');
          await Promise.all([loadSources(), loadServices(), loadFlow()]);
        } catch (error) {
          showNotice('actionResult', 'No se pudo escanear: ' + (error.message || error), 'danger');
        } finally {
          setBusy('scan', false);
        }
      });

      $('flowTemplate').addEventListener('change', updateTemplateDescription);
      $('applyTemplate').addEventListener('click', applySelectedTemplate);

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setNavOpen(false);
      });

      load().catch(error => {
        document.body.innerHTML = '<main><section class="panel"><h2>Error</h2><pre>'+esc(error.message || error)+'</pre></section></main>';
      });
    </script>
  </body>
</html>`;
}

const accessRequiredHtml = String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Acceso requerido</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; max-width: 760px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>Cloudflare Access requerido</h1>
    <p>Este admin está bloqueado hasta configurar una aplicación de Cloudflare Access para <strong>admin.angaflow.mx</strong>.</p>
    <p>Policy inicial requerida: permitir solo <strong>jose301184@gmail.com</strong>.</p>
  </body>
</html>`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}
