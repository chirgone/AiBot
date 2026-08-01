export interface GatherOptions {
  action: string;
  message: string;
  language: string;
  voice: string;
}

export function twimlGather(options: GatherOptions): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(options.action)}" method="POST" language="${escapeXml(options.language)}" speechTimeout="2" timeout="6" actionOnEmptyResult="true" hints="asesoría,propuesta integral,soluciones tecnológicas,cómputo,DaaS,Device as a Service,servidores,nube OnPremise,data center,almacenamiento,virtualización,redes,WiFi,LAN,ciberseguridad,videovigilancia,CCTV,monitoreo 24/7,SOC,NOC,soporte TI,mantenimiento TI,videocolaboración,audioconferencia,automatización de espacios,arrendamiento tecnológico,leasing,financiamiento,ataque,ransomware,mañana,pasado mañana,tarde,nombre,hora">
    <Say voice="${escapeXml(options.voice)}" language="${escapeXml(options.language)}">${escapeXml(options.message)}</Say>
  </Gather>
</Response>`;

  return twimlResponse(body);
}

export function twimlSayAndHangup(message: string, language: string, voice: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(voice)}" language="${escapeXml(language)}">${escapeXml(message)}</Say>
  <Hangup />
</Response>`;

  return twimlResponse(body);
}

function twimlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
