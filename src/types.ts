export type DialogState =
  | "greeting"
  | "topic_menu"
  | "collecting_info"
  | "answering_question"
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
  turnCount?: number;
  turnLimitReached?: boolean;
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
  menuTopics: string[];
  speechTimeout?: string;
  timeout?: string;
  notifyWebhookUrl?: string;
  notifyWebhookSecret?: string;
}

export interface TwilioVoiceRequest {
  callSid: string;
  from: string;
  to: string;
  speechResult: string;
  confidence?: number;
  digits?: string;
}
