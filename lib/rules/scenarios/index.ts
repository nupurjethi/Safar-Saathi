import flightDelayed from "./flight-delayed.json";
import missedConnection from "./missed-connection.json";
import hotelNotFound from "./hotel-not-found.json";
import transferNoShow from "./transfer-no-show.json";
import lostPassport from "./lost-passport.json";
import medicalHelp from "./medical-help.json";

export const SCENARIO_ORDER = ["flight-delayed", "missed-connection", "hotel-not-found", "transfer-no-show", "lost-passport", "medical-help"] as const;
export type ScenarioId = (typeof SCENARIO_ORDER)[number];

/** Hand-written default rules in the validated schema format. The fallback when the LLM is unavailable or fails validation. */
export const TEMPLATE_RULES: Record<ScenarioId, unknown> = {
  "flight-delayed": flightDelayed, "missed-connection": missedConnection, "hotel-not-found": hotelNotFound,
  "transfer-no-show": transferNoShow, "lost-passport": lostPassport, "medical-help": medicalHelp,
};
