import { describe, expect, it } from "vitest";
import { rateSeverity, SLA_SECONDS } from "@/lib/agent/severity";

describe("severity rubric", () => {
  it.each([
    ["SOS lost passport SS-48213", 1], ["my passport was stolen", 1], ["Ambulance needed my father collapsed", 1], ["I am stranded at the airport", 1],
    ["someone attacked me", 1], ["medical emergency", 1],
    ["I missed my connection", 2], ["we missed our flight to Rome", 2], ["the driver didn't come", 2], ["pickup hasn't arrived, nobody came", 2], ["I can't find my hotel", 2],
    ["what time is my pickup", 3], ["what is my hotel address", 3], ["flight is delayed by one hour", 3],
  ])("%s → severity %i", (text, sev) => {
    expect(rateSeverity(text).severity).toBe(sev);
  });

  it("severity 1 has a 60 second target", () => {
    expect(SLA_SECONDS[1]).toBe(60);
    expect(rateSeverity("lost passport").scenario).toBe("lost-passport");
  });
});
