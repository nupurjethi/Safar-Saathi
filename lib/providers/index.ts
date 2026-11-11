import { AmadeusFlightProvider } from "./amadeus";
import { DuffelFlightProvider } from "./duffel";
import { MockFlightProvider, MockStayProvider } from "./mock";
import type { FlightProvider, StayProvider } from "./types";

export * from "./types";
export { MOCK_SOURCE } from "./mock";

/** Mock is always first and always on. Real providers join only when their key is present. */
export const flightProviders = (): FlightProvider[] => [MockFlightProvider, AmadeusFlightProvider, DuffelFlightProvider].filter((p) => p.enabled());
export const stayProviders = (): StayProvider[] => [MockStayProvider].filter((p) => p.enabled());
