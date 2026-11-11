import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { listInbound, sendCap, sentCount, twilioConfig, twilioSend } from "@/lib/sms/twilio";
import { pollTwilio, processInbound } from "@/lib/sms/poll";
import { listAlerts } from "@/lib/server/cases";
import { setupDb } from "./helpers";

const ENV = { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACtest", TWILIO_API_KEY_SID: "SKtest", TWILIO_API_KEY_SECRET: "secret", SMS_GATEWAY_NUMBER: "+15550001111", TWILIO_SEND_CAP: "2" };
const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => { for (const k of Object.keys(ENV)) delete process.env[k]; };
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => { await setupDb(); });
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe("Twilio SMS: budget, polling, alerts", () => {
  it("authenticates with an API key and needs an account SID and a real from-number", () => {
    expect(twilioConfig()).toBeNull();
    setEnv();
    expect(twilioConfig()).toMatchObject({ accountSid: "ACtest", user: "SKtest", pass: "secret", from: "+15550001111" });
    process.env.SMS_GATEWAY_NUMBER = "+000000000000";
    expect(twilioConfig()).toBeNull(); // the placeholder number is not a gateway
  });

  it("never sends more than the cap: the 3rd send is refused without calling Twilio", async () => {
    setEnv();
    const db = await getDb();
    const fetchMock = vi.fn(async () => okJson({ sid: `SM${Math.random().toString(16).slice(2)}` }, 201));
    vi.stubGlobal("fetch", fetchMock);
    expect(sendCap()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const r = await twilioSend("+919800000009", "hi");
      expect(r.id).toMatch(/^SM/);
      await db.insert(s.smsMessages).values({ providerMessageId: r.id, direction: "out", fromMasked: "+91•••009", body: "hi" }); // what handleInboundSms records
    }
    expect(await sentCount(db)).toBe(2);
    const third = await twilioSend("+919800000009", "hi");
    expect(third.id).toMatch(/^capped-/);
    expect(third.error).toMatch(/cap/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // basic auth with the API key, account SID in the path
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/Accounts/ACtest/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("SKtest:secret").toString("base64")}`);
  });

  it("reads only INBOUND texts to our number (a free GET, nothing is sent)", async () => {
    setEnv();
    const fetchMock = vi.fn(async () => okJson({ messages: [
      { sid: "SMin1", direction: "inbound", from: "+919812345678", body: "SOS lost passport SS-48213", date_sent: "Wed, 11 Nov 2026 13:00:00 +0000", date_created: "Wed, 11 Nov 2026 13:00:00 +0000" },
      { sid: "SMout1", direction: "outbound-api", from: "+15550001111", body: "Case ID", date_sent: null, date_created: "Wed, 11 Nov 2026 13:00:05 +0000" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const msgs = await listInbound();
    expect(msgs.map((m) => m.sid)).toEqual(["SMin1"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method ?? "GET").toBe("GET");
    expect(url).toContain("To=%2B15550001111");
  });

  it("turns a text into a severity-1 alert on the agent's desk, once, and ignores old texts", async () => {
    const db = await getDb();
    const before = (await listAlerts(db)).length;
    const now = new Date();
    const msgs = [
      { sid: "SMa1", from: "+919812345678", body: "SOS lost passport SS-48213", dateSent: now.toISOString() },
      { sid: "SMold", from: "+919812345678", body: "SOS old message", dateSent: new Date(now.getTime() - 3 * 3600_000).toISOString() },
    ];
    // sim adapter here (SMS_PROVIDER unset): the reply goes nowhere, nothing is spent
    expect(await processInbound(db, msgs, new Date(now.getTime() - 3600_000))).toBe(1);
    expect(await processInbound(db, msgs, new Date(now.getTime() - 3600_000))).toBe(0); // same SID again
    const alerts = await listAlerts(db);
    expect(alerts.length).toBe(before + 1);
    const a = alerts[0];
    expect(a.channel).toBe("sms");
    expect(a.kind).toBe("SMS");
    expect(a.severity).toBe(1);
    expect(a.trip?.ref).toBe("SS-48213");
    expect(a.traveller?.name).toBe("Neha Kulkarni");
  });

  it("an unknown sender with no booking ref still alerts the agent", async () => {
    const db = await getDb();
    await processInbound(db, [{ sid: "SMu1", from: "+447700900123", body: "SOS I am hurt please help", dateSent: new Date().toISOString() }], new Date(Date.now() - 60_000));
    const a = (await listAlerts(db))[0];
    expect(a.trip).toBeNull();
    expect(a.severity).toBeLessThanOrEqual(2);
    expect(a.summary).toMatch(/Unmatched sender/);
    const out = await db.select().from(s.smsMessages).where(eq(s.smsMessages.direction, "out"));
    expect(out.some((m) => /Case ID/.test(m.body))).toBe(true);
  });

  it("polling does nothing unless Twilio is the active provider", async () => {
    expect(await pollTwilio({ force: true })).toMatchObject({ enabled: false, created: 0 });
  });
});
