/**
 * Severity rubric (spec 5.3). Rule-based on purpose: a safety call must not depend on a model.
 *  1 = safety, medical, lost passport, stranded  -> auto-escalate, 60 s target, agent never closes it
 *  2 = missed connection, no-show               -> human follow-up
 *  3 = information only
 */
export type Severity = 1 | 2 | 3;
export type Rating = { severity: Severity; reason: string; scenario?: string };

const RULES: { sev: Severity; re: RegExp; reason: string; scenario?: string }[] = [
  { sev: 1, re: /\b(lost|stolen|missing|robbed)\b.{0,30}\bpassport\b|\bpassport\b.{0,30}\b(lost|stolen|missing|gone)\b/i, reason: "Lost passport", scenario: "lost-passport" },
  { sev: 1, re: /\b(medical|ambulance|hospital|injur\w*|accident|bleeding|unconscious|chest pain|heart attack|can'?t breathe|seriously ill|very sick|poison\w*|overdos\w*)\b/i, reason: "Medical or injury", scenario: "medical-help" },
  { sev: 1, re: /\b(stranded|stuck overnight|no money|robbed|mugged|assault\w*|attacked|kidnap\w*|unsafe|threat\w*|lost (my )?(child|kid|son|daughter)|emergency|sos)\b/i, reason: "Safety or stranded" },
  { sev: 2, re: /\b(missed|miss(ing)?)\b.{0,25}\b(connection|connecting|flight|onward)\b|\bconnection\b.{0,20}\b(missed|miss)\b/i, reason: "Missed connection", scenario: "missed-connection" },
  { sev: 2, re: /\b(no[- ]?show|didn'?t (show|come)|not (here|there|come)|driver (is )?(late|missing|not)|pick-?up (didn'?t|has not|hasn'?t)|nobody (came|is here))\b/i, reason: "Transfer no-show", scenario: "transfer-no-show" },
  { sev: 2, re: /\b(hotel|reservation)\b.{0,30}\b(no booking|no record|not found|refus\w*|overbooked|cancel\w*)\b|\b(can'?t|cannot|unable to) find (my |the )?hotel\b/i, reason: "Hotel problem", scenario: "hotel-not-found" },
];

export function rateSeverity(text: string): Rating {
  for (const r of RULES) if (r.re.test(text)) return { severity: r.sev, reason: r.reason, scenario: r.scenario };
  if (/\b(delay\w*|late flight|flight (is )?late)\b/i.test(text)) return { severity: 3, reason: "Flight delay (information)", scenario: "flight-delayed" };
  return { severity: 3, reason: "Information only" };
}

export const SLA_SECONDS: Record<Severity, number> = { 1: 60, 2: 15 * 60, 3: 4 * 3600 };
