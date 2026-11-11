import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { __setLlmDrafter, type LlmRequest } from "@/lib/llm";
import { kindOf, parseFile } from "@/lib/plans/parse";
import { normalise } from "@/lib/plans/extract";
import { PlanSchema, planWarnings } from "@/lib/plans/schema";
import { processPlan } from "@/lib/plans/process";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { addDays } from "@/lib/time";
import { setupDb, BASE_DATE } from "./helpers";

process.env.PLAN_GEOCODER = "off"; // tests use our own seeded geography only (no network)
process.env.PLAN_ROUTING = "off";

// A tiny but real PDF with one line of text
const PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 66>>stream
BT /F1 12 Tf 20 100 Td (Flight EK 501 Mumbai BOM to Dubai DXB) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
0000000214 00000 n 
0000000330 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
393
%%EOF`);

describe("reading uploaded documents", () => {
  it("knows file kinds", () => {
    expect(kindOf("ticket.pdf", "application/pdf")).toBe("pdf");
    expect(kindOf("plan.docx", "")).toBe("word");
    expect(kindOf("plan.xlsx", "")).toBe("sheet");
    expect(kindOf("plan.csv", "text/csv")).toBe("sheet");
    expect(kindOf("shot.png", "image/png")).toBe("image");
    expect(kindOf("mail.eml", "")).toBe("text");
    expect(kindOf("deck.pptx", "")).toBe("unsupported");
  });
  it("reads PDF text, Excel rows, CSV, plain text and images; explains what it cannot read", async () => {
    const pdf = await parseFile("ticket.pdf", "application/pdf", PDF);
    expect(pdf.text).toContain("EK 501");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Day plan");
    ws.addRow(["Date", "Time", "Activity", "Place"]);
    ws.addRow(["2026-12-02", "10:00", "Top of the tower", "Burj Khalifa"]);
    const xlsx = await parseFile("plan.xlsx", "", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(xlsx.text).toMatch(/Sheet: Day plan[\s\S]*Burj Khalifa/);
    expect((await parseFile("a.csv", "text/csv", Buffer.from("date,place\n2026-12-02,Dubai Mall"))).text).toContain("Dubai Mall");
    expect((await parseFile("v.html", "text/html", Buffer.from("<html><body><p>Hotel <b>Rove</b></p><script>x()</script></body></html>"))).text).toMatch(/Hotel\s+Rove/);
    const img = await parseFile("shot.png", "image/png", Buffer.from([137, 80, 78, 71]));
    expect(img.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    const bad = await parseFile("deck.pptx", "", Buffer.from("x"));
    expect(bad.text).toBeUndefined();
    expect(bad.note).toMatch(/cannot be read/);
    expect(pdf.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

const start = addDays(BASE_DATE, 3), end = addDays(BASE_DATE, 7);
const MODEL_JSON = {
  title: "Dubai family trip, 4 nights", travellers: [{ name: "Ravi Kumar" }, { name: "Asha Kumar" }], pax: 2, startDate: start, endDate: end, homeCity: "Mumbai",
  cities: [{ name: "Dubai", country: "United Arab Emirates", timezone: "Asia/Dubai", from: start, to: end }],
  flights: [
    { airline: "Emirates", flightNo: "ek 501", from: "bom", to: "dxb", fromCity: "Mumbai", toCity: "Dubai", departLocal: `${start} 04:30`, arriveLocal: `${start}T06:15`, fromTimezone: "Asia/Kolkata", toTimezone: "Asia/Dubai", pnr: "ABC123" },
    { airline: "Emirates", flightNo: "EK500", from: "DXB", to: "BOM", fromCity: "Dubai", toCity: "Mumbai", departLocal: `${end}T21:00`, arriveLocal: `${addDays(end, 1)}T01:35`, fromTimezone: "Asia/Dubai", toTimezone: "Asia/Kolkata" },
  ],
  hotels: [{ name: "Rove Downtown", address: "Downtown Dubai", city: "Dubai", checkin: start, checkout: end, phone: "+971 4 561 9999", confirmation: "RV7788" }],
  activities: [{ date: addDays(start, 1), time: "10:00", title: "Top of the tower", place: "Burj Khalifa", city: "Dubai" }, { date: addDays(start, 2), title: "Shopping", place: "Dubai Mall", city: "Dubai" }],
  transfers: [{ date: start, time: "07:00", from: "DXB Airport", to: "Rove Downtown", city: "Dubai", provider: "Desert Cabs", driver: "Imran", phone: "+971 50 000 0000", code: "DC42" }],
  contacts: [{ label: "Travel insurance", phone: "+91 22 0000 0000" }],
  notes: [""],
};

describe("plan schema", () => {
  it("normalises codes and accepts a model answer; never invents missing fields", () => {
    const p = PlanSchema.parse(normalise(MODEL_JSON));
    expect(p.flights[0]).toMatchObject({ flightNo: "EK501", from: "BOM", to: "DXB", departLocal: `${start}T04:30` });
    expect(p.flights[1].pnr).toBeUndefined();
    expect(p.notes).toEqual([]);
    expect(planWarnings(p)).toEqual([]);
    expect(planWarnings({ ...p, hotels: [] })).toContain("No hotel found in your documents. The guide uses the city centre as your base.");
  });
});

describe("Add travel plan agent: documents -> trip -> full offline bundle", () => {
  let c: Awaited<ReturnType<typeof setupDb>>;
  const seen: LlmRequest[] = [];
  beforeAll(async () => {
    c = await setupDb();
    __setLlmDrafter(async (req) => { seen.push(req); if (req.purpose === "plan") return JSON.stringify(MODEL_JSON); throw new Error("rules: use template"); });
  });
  afterAll(() => __setLlmDrafter(null));

  it("builds a confirmed trip with flights, hotel, day plan, real map pins, offline map tiles, routes, guides and SOS contacts, then deletes the documents", async () => {
    const db = await getDb();
    const [plan] = await db.insert(s.travelPlans).values({ userId: c.neha.id, status: "uploading" }).returning();
    const pdf = await parseFile("ticket.pdf", "application/pdf", PDF);
    await db.insert(s.planFiles).values([
      { planId: plan.id, name: "ticket.pdf", mime: "application/pdf", kind: "pdf", bytes: PDF.length, sha256: pdf.sha256, status: "parsed", text: pdf.text },
      { planId: plan.id, name: "voucher.png", mime: "image/png", kind: "image", bytes: 4, sha256: "x", status: "parsed", imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      { planId: plan.id, name: "deck.pptx", mime: "", kind: "unsupported", bytes: 1, sha256: "y", status: "skipped", note: "This file type cannot be read yet." },
    ]);
    const steps: string[] = [];
    const r = await processPlan(plan.id, c.neha.id, (l) => steps.push(l));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(steps[0]).toMatch(/Gemini/);
    // the model saw the PDF text and the image
    const req = seen.find((x) => x.purpose === "plan")!;
    expect(req.prompt).toContain("EK 501");
    expect(req.images).toHaveLength(1);
    expect(r.warnings.some((w) => w.startsWith("deck.pptx"))).toBe(true);

    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, r.ref));
    expect(b).toMatchObject({ source: "upload", status: "confirmed", pax: 2, startDate: start, itineraryId: null });
    const pack = (await getLatestPack(b.id))!.pack as OfflinePack;
    expect(pack.booking.title).toBe("Dubai family trip, 4 nights");
    expect(pack.booking.travellers).toEqual(["Ravi Kumar", "Asha Kumar"]);
    // flights converted from local times to real instants
    expect(pack.flights.map((f) => f.flight_no)).toEqual(["EK501", "EK500"]);
    expect(pack.flights[0].depart_at).toBe(new Date(`${start}T04:30:00+05:30`).toISOString());
    expect(pack.flights[0].pnr).toBe("ABC123");
    // hotel, airport and landmarks are real pins (seeded coordinates for Dubai)
    const hotel = Object.values(pack.places).find((p) => p.kind === "hotel")!;
    expect(hotel.name).toBe("Rove Downtown");
    expect(pack.places.airport_DXB.lat).toBeCloseTo(25.2532, 3);
    expect(Object.values(pack.places).some((p) => p.name === "Burj Khalifa" && Math.abs(p.lat - 25.197) < 0.01)).toBe(true);
    // Dubai is one of our cities: the real offline street map tiles are reused
    expect(pack.map.cities[0].pmtiles).toMatch(/dubai\.pmtiles$/);
    // day plan covers every day with the documents' items
    expect(pack.days.length).toBe(5);
    expect(pack.days[1].items.some((i) => i.title === "Top of the tower" && i.time === "10:00")).toBe(true);
    expect(pack.days[2].items.find((i) => i.title === "Shopping")!.notes).toMatch(/Time not in your documents/);
    // stays, pickup from the documents, SOS numbers, guides
    expect(pack.stays[0]).toMatchObject({ city: "dubai", tz: "Asia/Dubai", airportId: "airport_DXB" });
    expect(pack.stays[0].driver).toMatchObject({ name: "Imran", vendor: "Desert Cabs", pickup_code: "DC42" });
    expect(pack.stays[0].emergency.general).toBeTruthy();
    expect(pack.contacts.insurance_phone).toBe("+91 22 0000 0000");
    expect(Object.keys(pack.rules).length).toBeGreaterThanOrEqual(6);
    expect(pack.routes.some((rt) => rt.from === "airport_DXB" && rt.to === pack.stays[0].hotelId)).toBe(true);
    // documents are not kept after processing
    const files = await db.select().from(s.planFiles).where(eq(s.planFiles.planId, plan.id));
    expect(files.every((f) => f.text === null && f.imageDataUrl === null)).toBe(true);
    const [after] = await db.select().from(s.travelPlans).where(eq(s.travelPlans.id, plan.id));
    expect(after.status).toBe("ready");
    expect(after.bookingId).toBe(b.id);
  });

  it("refuses someone else's plan and reports a model failure plainly", async () => {
    const db = await getDb();
    const [plan] = await db.insert(s.travelPlans).values({ userId: c.neha.id, status: "uploading" }).returning();
    await db.insert(s.planFiles).values({ planId: plan.id, name: "x.txt", mime: "text/plain", kind: "text", bytes: 1, sha256: "z", status: "parsed", text: "hello" });
    expect(await processPlan(plan.id, "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false });
    __setLlmDrafter(async () => "not json at all");
    const r = await processPlan(plan.id, c.neha.id);
    expect(r).toMatchObject({ ok: false });
    const [after] = await db.select().from(s.travelPlans).where(eq(s.travelPlans.id, plan.id));
    expect(after.status).toBe("failed");
  });
});

describe("a plan with no flights (e.g. a rail-and-hotel itinerary) still gets a full guide", () => {
  it("builds the rules context with placeholders instead of failing validation", async () => {
    const { buildContext } = await import("@/lib/rules/context");
    const db = await getDb();
    const [bk] = await db.select().from(s.bookings).where(eq(s.bookings.ref, "SS-48213"));
    const pack = (await getLatestPack(bk.id))!.pack as OfflinePack;
    const ctx = buildContext({ ...pack, flights: [] }) as { current: { next_flight: Record<string, string>; onward_flight: Record<string, string> } };
    for (const k of ["carrier", "flight_no", "depart", "pnr"]) { expect(ctx.current.next_flight[k]).toBeTruthy(); expect(ctx.current.onward_flight[k]).toBeTruthy(); }
  });
});
