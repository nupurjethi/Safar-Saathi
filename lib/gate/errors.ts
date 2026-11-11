export type GateCode =
  | "NO_TOKEN" | "TOKEN_INVALID" | "TOKEN_USED" | "TOKEN_EXPIRED" | "TOKEN_MISMATCH"
  | "QUOTE_NOT_FOUND" | "QUOTE_EXPIRED" | "QUOTE_NOT_OPEN" | "QUOTE_TAMPERED"
  | "FORBIDDEN" | "UNAUTHENTICATED" | "OVER_LIMIT" | "PRICE_CHANGED"
  | "NOT_BOOKED" | "BAD_REQUEST" | "NOT_FOUND" | "NO_AVAILABILITY" | "CHANGE_WINDOW_CLOSED" | "RATE_LIMITED";

export class GateError extends Error {
  constructor(public code: GateCode, public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
  toJSON() {
    return { error: this.code, message: this.message, ...this.extra };
  }
}
