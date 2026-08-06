export interface FlowTemplateStep {
  slotKey: "nombre_cliente" | "motivo" | "fecha_hora" | "telefono";
  prompt: string;
  retryPrompt?: string;
}

export interface FlowTemplate {
  id: string;
  vertical: string;
  level: "simple" | "recommended" | "advanced";
  name: string;
  description: string;
  greeting: string;
  confirmationTemplate: string;
  completionMessage: string;
  fallbackMessage: string;
  speechHints: string[];
  steps: FlowTemplateStep[];
}

export const flowTemplates: FlowTemplate[] = [
  {
    id: "general-simple",
    vertical: "General / Conversacional",
    level: "simple",
    name: "Lead capture básico",
    description: "Captura nombre, tema y horario. Ideal para validar un negocio rápidamente.",
    greeting: "Gracias por llamar a {business_name}. Soy tu asistente virtual. Te ayudo a canalizar tu solicitud.",
    confirmationTemplate: "Perfecto. Tengo registrada una solicitud para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
    completionMessage: "Listo, quedó registrada tu solicitud. Una persona del equipo dará seguimiento. Que tengas buen día.",
    fallbackMessage: "Perdón, no te escuché bien. ¿Me lo repites un poco más despacio?",
    speechHints: ["información", "servicio", "asesoría", "agenda", "cita", "soporte", "ventas", "nombre", "hora"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me regalas tu nombre, por favor?" },
      { slotKey: "motivo", prompt: "Perfecto, {nombre_cliente}. Cuéntame qué necesitas o sobre qué servicio quieres información." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y a qué hora te gustaría que te contacte una persona del equipo?" },
    ],
  },
  {
    id: "general-recommended",
    vertical: "General / Conversacional",
    level: "recommended",
    name: "Calificación consultiva",
    description: "Mejor para ventas inbound: entiende necesidad, agenda y confirma con tono profesional.",
    greeting: "Gracias por contactar a {business_name}. Soy tu asistente virtual. Te ayudo a entender tu necesidad y conectarte con la persona correcta.",
    confirmationTemplate: "Gracias. Confirmo una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. El objetivo es revisar tu necesidad y definir el mejor siguiente paso. ¿Es correcto?",
    completionMessage: "Perfecto, tu solicitud quedó registrada. El equipo dará seguimiento con el contexto que compartiste.",
    fallbackMessage: "Perdón, no lo capté completo. ¿Me lo puedes repetir de forma breve?",
    speechHints: ["asesoría", "cotización", "servicio", "problema", "necesidad", "consultoría", "agenda", "seguimiento"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "Con gusto te ayudo. ¿Cuál es tu nombre?" },
      { slotKey: "motivo", prompt: "Perfecto, {nombre_cliente}. Dime qué necesitas resolver o qué servicio estás buscando; con eso te oriento mejor." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para que el equipo te contacte?" },
    ],
  },
  {
    id: "general-advanced",
    vertical: "General / Conversacional",
    level: "advanced",
    name: "Handoff inteligente",
    description: "Para conversaciones complejas: usa prompts de contexto y prepara transferencia humana si hace falta.",
    greeting: "Gracias por comunicarte con {business_name}. Soy tu asistente conversacional. Puedo orientarte, registrar tu solicitud y escalarla con una persona cuando sea necesario.",
    confirmationTemplate: "Tengo registrada una solicitud para {nombre_cliente}, {fecha_hora}, relacionada con {motivo}. Si el equipo necesita más detalle, te contactará directamente. ¿Confirmo así?",
    completionMessage: "Listo. Tu solicitud quedó registrada y será revisada por el equipo adecuado. Gracias por contactarnos.",
    fallbackMessage: "Perdón, quiero asegurarme de entender bien. ¿Me lo puedes repetir con una frase corta?",
    speechHints: ["hablar con humano", "urgente", "problema", "soporte", "cotización", "asesoría", "reagendar", "seguimiento"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "Para registrar bien la conversación, ¿cuál es tu nombre?" },
      { slotKey: "motivo", prompt: "Perfecto, {nombre_cliente}. Cuéntame brevemente qué necesitas; si es urgente o requiere una persona, también dímelo." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora prefieres para recibir seguimiento del equipo?" },
    ],
  },
  {
    id: "technology-simple",
    vertical: "Tecnología / Infraestructura TI",
    level: "simple",
    name: "Asesoría TI básica",
    description: "Captura interés en soluciones tecnológicas y agenda contacto técnico/comercial.",
    greeting: "Gracias por llamar a {business_name}. Soy tu asistente virtual. Te ayudo a canalizar tu solicitud tecnológica.",
    confirmationTemplate: "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
    completionMessage: "Listo, quedó registrada tu solicitud. Un especialista dará seguimiento.",
    fallbackMessage: "Perdón, no te escuché bien. ¿Me lo repites un poco más despacio?",
    speechHints: ["TI", "soporte", "infraestructura", "ciberseguridad", "nube", "servidores", "redes", "monitoreo"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me regalas tu nombre, por favor?" },
      { slotKey: "motivo", prompt: "Perfecto, {nombre_cliente}. Dime qué necesitas resolver; puede ser infraestructura, nube, seguridad, soporte o monitoreo." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te gustaría que te contacte un especialista?" },
    ],
  },
  {
    id: "technology-recommended",
    vertical: "Tecnología / Infraestructura TI",
    level: "recommended",
    name: "Calificación TI consultiva",
    description: "Recomendado para empresas de tecnología: identifica solución, contexto operativo y agenda especialista.",
    greeting: "Gracias por llamar a {business_name}. Soy tu asistente virtual. Te ayudo a identificar la solución tecnológica adecuada para tu operación.",
    confirmationTemplate: "Perfecto. Tengo registrada una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. La idea es revisar una solución adecuada para tu operación. ¿Es correcto?",
    completionMessage: "Listo, quedó registrada tu solicitud. Un especialista dará seguimiento con el contexto de tu operación.",
    fallbackMessage: "Perdón, no lo escuché completo. ¿Me puedes repetir el servicio o problema principal?",
    speechHints: ["cómputo", "DaaS", "servidores", "nube", "redes", "ciberseguridad", "SOC", "NOC", "videocolaboración", "arrendamiento"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "Con gusto te ayudo. ¿Cuál es tu nombre?" },
      { slotKey: "motivo", prompt: "Perfecto, {nombre_cliente}. Cuéntame qué necesitas resolver; puede ser cómputo, nube, redes, ciberseguridad, monitoreo, colaboración o arrendamiento tecnológico." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para una asesoría con un especialista?" },
    ],
  },
  {
    id: "technology-advanced",
    vertical: "Tecnología / Infraestructura TI",
    level: "advanced",
    name: "Soporte, ventas y emergencia TI",
    description: "Para escenarios mixtos: cotización, soporte, incidentes y handoff humano por urgencia.",
    greeting: "Gracias por comunicarte con {business_name}. Soy tu asistente conversacional. Puedo orientarte sobre soluciones tecnológicas, registrar una solicitud o escalar un caso urgente.",
    confirmationTemplate: "Confirmo: solicitud para {nombre_cliente}, {fecha_hora}, relacionada con {motivo}. Si detectamos urgencia, el equipo la priorizará. ¿Es correcto?",
    completionMessage: "Listo. La solicitud quedó registrada para seguimiento especializado. Gracias por comunicarte.",
    fallbackMessage: "Perdón, quiero entenderlo bien. ¿Es una cotización, soporte o una situación urgente?",
    speechHints: ["urgente", "ataque", "ransomware", "soporte", "incidente", "cotización", "ciberseguridad", "SOC", "NOC", "nube", "servidores"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "Para registrar el caso, ¿cuál es tu nombre?" },
      { slotKey: "motivo", prompt: "Cuéntame si buscas una cotización, soporte técnico o atención urgente, y sobre qué tecnología." },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora prefieres para que el equipo especializado te contacte?" },
    ],
  },
  {
    id: "health-simple",
    vertical: "Salud / Clínicas",
    level: "simple",
    name: "Agenda clínica básica",
    description: "Captura nombre, motivo de consulta y horario preferido.",
    greeting: "Gracias por llamar a {business_name}. Soy tu asistente virtual. Te ayudo a registrar tu solicitud. ¿Me regalas tu nombre?",
    confirmationTemplate: "Perfecto. Tengo registrada una solicitud para {nombre_cliente}, {fecha_hora}, por {motivo}. ¿Es correcto?",
    completionMessage: "Listo, tu solicitud quedó registrada. El equipo dará seguimiento.",
    fallbackMessage: "Perdón, no te escuché bien. ¿Me lo repites?",
    speechHints: ["cita", "consulta", "revisión", "urgencia", "agenda", "doctor", "clínica"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me regalas tu nombre, por favor?" },
      { slotKey: "motivo", prompt: "¿Cuál es el motivo de tu consulta?" },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora prefieres para que te contacten?" },
    ],
  },
  {
    id: "professional-services-recommended",
    vertical: "Servicios Profesionales",
    level: "recommended",
    name: "Asesoría profesional",
    description: "Para despachos, consultoras y servicios B2B que necesitan calificar solicitudes.",
    greeting: "Gracias por contactar a {business_name}. Soy tu asistente virtual. Te ayudo a registrar tu solicitud y canalizarla con el equipo correcto. ¿Cuál es tu nombre?",
    confirmationTemplate: "Confirmo una asesoría para {nombre_cliente}, {fecha_hora}, sobre {motivo}. ¿Es correcto?",
    completionMessage: "Listo, tu solicitud quedó registrada. El equipo dará seguimiento con el contexto compartido.",
    fallbackMessage: "Perdón, no lo capté completo. ¿Me lo puedes repetir brevemente?",
    speechHints: ["asesoría", "consulta", "servicio", "cotización", "proyecto", "seguimiento", "agenda"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me compartes tu nombre?" },
      { slotKey: "motivo", prompt: "¿Sobre qué servicio, proyecto o necesidad quieres hablar?" },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para recibir seguimiento?" },
    ],
  },
  {
    id: "retail-recommended",
    vertical: "Retail / Comercio",
    level: "recommended",
    name: "Atención comercial retail",
    description: "Para tiendas y comercios: producto, disponibilidad, cotización y seguimiento.",
    greeting: "Gracias por llamar a {business_name}. Soy tu asistente virtual. Te ayudo con información de productos, servicios o seguimiento comercial. ¿Me compartes tu nombre?",
    confirmationTemplate: "Confirmo una solicitud para {nombre_cliente}, {fecha_hora}, sobre {motivo}. El equipo revisará disponibilidad o siguiente paso comercial. ¿Es correcto?",
    completionMessage: "Listo, tu solicitud quedó registrada. El equipo comercial dará seguimiento.",
    fallbackMessage: "Perdón, no lo capté bien. ¿Me repites el producto o servicio que buscas?",
    speechHints: ["producto", "precio", "disponibilidad", "tienda", "pedido", "cotización", "envío", "promoción"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me compartes tu nombre?" },
      { slotKey: "motivo", prompt: "¿Qué producto, servicio o pedido quieres revisar?" },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para que el equipo comercial te contacte?" },
    ],
  },
  {
    id: "hospitality-recommended",
    vertical: "Hotelería / Hospitalidad",
    level: "recommended",
    name: "Reservas y atención a huéspedes",
    description: "Para hoteles, restaurantes y hospitalidad: reservas, eventos, dudas y seguimiento humano.",
    greeting: "Gracias por comunicarte con {business_name}. Soy tu asistente virtual. Te ayudo con reservas, información o solicitudes especiales. ¿Me regalas tu nombre?",
    confirmationTemplate: "Tengo registrada una solicitud para {nombre_cliente}, {fecha_hora}, sobre {motivo}. El equipo dará seguimiento a tu reserva o requerimiento. ¿Confirmo así?",
    completionMessage: "Listo, tu solicitud quedó registrada. El equipo de atención dará seguimiento.",
    fallbackMessage: "Perdón, no lo escuché completo. ¿Es una reserva, evento o solicitud especial?",
    speechHints: ["reserva", "habitación", "evento", "mesa", "huésped", "check in", "restaurante", "tarifa"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me regalas tu nombre, por favor?" },
      { slotKey: "motivo", prompt: "¿Buscas una reserva, información de disponibilidad, evento o solicitud especial?" },
      { slotKey: "fecha_hora", prompt: "¿Para qué día y hora quieres que el equipo te contacte o revise disponibilidad?" },
    ],
  },
  {
    id: "government-simple",
    vertical: "Gobierno / Sector Público",
    level: "simple",
    name: "Orientación ciudadana básica",
    description: "Para instituciones: orientar solicitudes y canalizar al área correcta.",
    greeting: "Gracias por comunicarte con {business_name}. Soy tu asistente virtual. Te ayudo a registrar tu solicitud y canalizarla al área correspondiente. ¿Me indicas tu nombre?",
    confirmationTemplate: "Confirmo una solicitud para {nombre_cliente}, {fecha_hora}, relacionada con {motivo}. ¿Es correcto?",
    completionMessage: "Listo, tu solicitud quedó registrada para seguimiento del área correspondiente.",
    fallbackMessage: "Perdón, no lo capté completo. ¿Me puedes repetir el trámite o tema principal?",
    speechHints: ["trámite", "servicio", "ciudadano", "solicitud", "cita", "seguimiento", "área", "documento"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Cuál es tu nombre?" },
      { slotKey: "motivo", prompt: "¿Sobre qué trámite, servicio o solicitud necesitas orientación?" },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para recibir seguimiento?" },
    ],
  },
  {
    id: "education-recommended",
    vertical: "Educación / Escuelas",
    level: "recommended",
    name: "Admisiones y atención escolar",
    description: "Para escuelas y universidades: admisiones, informes, citas y seguimiento académico.",
    greeting: "Gracias por comunicarte con {business_name}. Soy tu asistente virtual. Te ayudo con información, admisiones o seguimiento escolar. ¿Me compartes tu nombre?",
    confirmationTemplate: "Tengo registrada una solicitud para {nombre_cliente}, {fecha_hora}, sobre {motivo}. El equipo escolar dará seguimiento. ¿Es correcto?",
    completionMessage: "Listo, tu solicitud quedó registrada. El equipo de atención escolar dará seguimiento.",
    fallbackMessage: "Perdón, no lo escuché bien. ¿Buscas informes, admisiones, colegiaturas o seguimiento académico?",
    speechHints: ["admisiones", "informes", "colegiatura", "inscripción", "escuela", "alumno", "beca", "cita"],
    steps: [
      { slotKey: "nombre_cliente", prompt: "¿Me compartes tu nombre?" },
      { slotKey: "motivo", prompt: "¿Buscas informes, admisiones, colegiaturas, becas o seguimiento académico?" },
      { slotKey: "fecha_hora", prompt: "¿Qué día y hora te funciona para que el equipo te contacte?" },
    ],
  },
];

export function getTemplatesForVertical(vertical?: string): FlowTemplate[] {
  const normalized = vertical?.trim().toLowerCase();
  const general = flowTemplates.filter((template) => template.vertical === "General / Conversacional");
  if (!normalized) return flowTemplates;

  const matches = flowTemplates.filter((template) => template.vertical.toLowerCase() === normalized);
  return matches.length ? [...matches, ...general] : general;
}

export function getTemplateById(templateId: string): FlowTemplate | undefined {
  return flowTemplates.find((template) => template.id === templateId);
}
