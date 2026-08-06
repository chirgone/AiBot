export type DialogState =
  | "greeting"
  | "collecting_info"
  | "confirming"
  | "booked"
  | "cancelled"
  | "error";

export interface ConversationSlots {
  nombre_cliente?: string;
  telefono?: string;
  fecha_hora?: string;
  motivo?: string;
}

export interface ConversationContext {
  id: string;
  phoneNumber: string;
  dialogState: DialogState;
  slots: ConversationSlots;
}

export interface ProcessTurnResult {
  responseText: string;
  dialogState: DialogState;
  missingSlots: (keyof ConversationSlots)[];
  isComplete: boolean;
  appointmentId?: string;
  slots?: ConversationSlots;
  urgent?: boolean;
  urgencyPhrase?: string;
}

export interface RuntimePromptConfig {
  tenantId: string;
  businessName: string;
  assistantName: string;
  language: string;
  voice: string;
  timeZone: string;
  greeting: string;
  confirmationTemplate: string;
  completionMessage: string;
  fallbackMessage: string;
  speechHints: string[];
  prompts: Partial<Record<keyof ConversationSlots, string>>;
  knowledgeSummary: string;
  services: Array<{ name: string; description: string; keywords: string[] }>;
}

export interface TwilioVoiceRequest {
  callSid: string;
  from: string;
  to: string;
  speechResult: string;
  confidence?: string;
  digits?: string;
}
