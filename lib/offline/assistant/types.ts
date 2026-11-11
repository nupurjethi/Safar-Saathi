/** Shapes shared by the offline, rule-based assistant. Pure data: no React, no network. */
export type IntentId =
  | "help" | "thanks" | "hotel" | "flights" | "pickup" | "today" | "booking" | "emergency" | "embassy" | "insurance"
  | "currency" | "tipping" | "plug" | "sim" | "safety" | "language" | "weather" | "routes" | "sos" | "offline" | "change"
  | "flight-delayed" | "missed-connection" | "hotel-not-found" | "transfer-no-show" | "lost-passport" | "medical-help"
  | "lost-luggage" | "phone-lost" | "money-lost" | "scam";

export type OaStep = { text: string; call?: string; callLabel?: string; show?: string };
export type OaLink = { label: string; href: string; kind: "call" | "map" | "page" };
export type OaAsk = { question: string; options: { label: string; branch: string }[] };

export type OaAnswer = {
  /** What the question was matched to. "none" = nothing matched well enough. */
  intent: IntentId | "none";
  title: string;
  /** Short paragraphs. Every fact in them comes from the saved pack (see `cites`) or the built-in basics (`generic`). */
  lines: string[];
  steps: OaStep[];
  ask?: OaAsk;
  /** Set when `steps` come from a frozen rule set in the pack: lets the UI walk the decision tree offline. */
  scenarioId?: string;
  /** The stay (destination slug) the answer was built for, so the UI can keep walking the same tree. */
  city?: string;
  links: OaLink[];
  /** Where each fact came from, e.g. "Your booking: Day 1, 14:00". */
  cites: string[];
  /** true when part of the answer is built-in general guidance rather than your booking. */
  generic: boolean;
  /** 0 to 1 */
  confidence: number;
  low: boolean;
  /** Changes (book, move, cancel, extend) can only happen online with a Confirm tap. */
  needsOnline: boolean;
  urgent: boolean;
  /** Placeholders that could not be resolved from the pack (shown as a warning, never invented). */
  missing: string[];
  suggestions: string[];
  /** Other intents that scored close, so the UI can offer "Did you mean". */
  alternatives: { intent: IntentId; question: string }[];
};

export const ASSISTANT_LABEL = "Offline assistant · rule-based, not AI";
