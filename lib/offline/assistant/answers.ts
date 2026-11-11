import type { OfflinePack, PackDay, PackFlight, PackStay } from "@/lib/packs/types";
import { buildContext } from "@/lib/rules/context";
import { MISSING, resolve, walk } from "@/lib/rules/engine";
import { telHref, pickupItem } from "@/lib/trip/derive";
import { addDays, daysBetween, fmtDate, fmtTimeZ, inr, localDate } from "@/lib/time";
import { basicsFor } from "./knowledge";
import { exampleFor } from "./intents";
import type { Entities } from "./extract";
import type { IntentId, OaAnswer, OaLink, OaStep } from "./types";

export type Env = { pack: OfflinePack; now: Date; stay: PackStay; ent: Entities; question: string; answers: string[] };

const SAMPLE = " (sample number in this prototype)";
const isSampleNo = (pack: OfflinePack) => (pack.contacts.sample ? SAMPLE : "");

export function blank(intent: OaAnswer["intent"], title: string): OaAnswer {
  return { intent, title, lines: [], steps: [], links: [], cites: [], generic: false, confidence: 1, low: false, needsOnline: false, urgent: false, missing: [], suggestions: [], alternatives: [] };
}
const tel = (label: string, number: string): OaLink => ({ label: `${label} ${number}`, href: telHref(number), kind: "call" });
const hasNumber = (s?: string) => !!s && /\d/.test(s);

const fmtFlight = (f: PackFlight) =>
  `${f.flight_no} · ${f.carrier} · ${f.from} to ${f.to} · departs ${dayShort(f.depart_at, f.from_tz)} ${fmtTimeZ(f.depart_at, f.from_tz)} · arrives ${fmtTimeZ(f.arrive_at, f.to_tz)} · booking code ${f.pnr}`;
const dayShort = (iso: string, tz: string) => fmtDate(localDate(new Date(iso), tz));

function mapLink(pack: OfflinePack, stay: PackStay): OaLink {
  const rid = `${stay.airportId}__${stay.hotelId}`;
  const has = pack.routes.some((r) => r.id === rid);
  return { label: "Open offline map", href: `/trips/${pack.booking.ref}/map?${has ? `route=${encodeURIComponent(rid)}&` : ""}pin=${stay.hotelId}`, kind: "map" };
}

/* ---------- frozen rule sets (the six scenarios) ---------- */

export function guidance(env: Env, id: string): OaAnswer | null {
  const { pack, now, stay } = env;
  const sc = pack.rules[id];
  if (!sc) return null;
  const ctx = buildContext(pack, now, stay.city);
  const missing: string[] = [];
  const res = resolve(sc, ctx, (p) => missing.push(p));
  const { steps, ask } = walk(res, env.answers);
  const a = blank(id as IntentId, sc.title);
  a.scenarioId = id;
  a.city = stay.city;
  a.lines = [res.when];
  a.steps = steps.map((s) => ({ text: s.text, call: s.call, callLabel: s.callLabel, show: s.show }));
  a.ask = ask;
  a.urgent = sc.severity === 1;
  a.missing = [...new Set(missing)];
  // same checks as the rule validators: nothing unresolved, no invented placeholders
  if (JSON.stringify(a.steps).includes(MISSING) || JSON.stringify(a.steps).includes("{{")) a.lines.push("Some details are not in your booking. I did not guess them.");
  for (const s of a.steps) if (s.call && hasNumber(s.call)) a.links.push(tel(s.callLabel ?? "Call", s.call));
  if (steps.some((s) => s.map === "hotel")) a.links.push(mapLink(pack, stay));
  a.links.push({ label: sc.sos ? "SOS: reach a person" : "Still stuck? SOS", href: `/trips/${pack.booking.ref}/sos`, kind: "page" });
  a.cites = [`Your offline guide: ${sc.title} (${pack.rulesMeta.label})`, `Stay in ${stay.cityName}: emergency, consulate and driver details`];
  a.suggestions = ["What is the police number?", "Where is my hotel?"];
  return a;
}

/* ---------- standard guidance for problems that are not one of the six frozen scenarios ---------- */

function standard(env: Env, id: "lost-luggage" | "phone-lost" | "money-lost" | "scam"): OaAnswer {
  const { pack, stay } = env;
  const hotel = pack.places[stay.hotelId];
  const police = stay.emergency.police, general = stay.emergency.general;
  const air = pack.contacts.airline, airPhone = pack.contacts.airline_phone, ins = pack.contacts.insurance_phone;
  const S = (text: string, call?: string, callLabel?: string): OaStep => ({ text, call, callLabel });
  const titles = { "lost-luggage": "Luggage missing or delayed", "phone-lost": "Phone lost or stolen", "money-lost": "Wallet, cash or cards lost", scam: "Scam, overcharging or theft" } as const;
  const a = blank(id, titles[id]);
  a.generic = true;
  const steps: Record<typeof id, OaStep[]> = {
    "lost-luggage": [
      S("Do not leave the baggage area yet. Go to your airline's baggage desk and file a missing-baggage report (a property irregularity report). Ask for the reference number."),
      S(`Your airline on this trip is ${air}. Phone: ${airPhone}${isSampleNo(pack)}.`, airPhone, "Airline"),
      S(`Give them your hotel for delivery: ${hotel?.name ?? MISSING}, ${hotel?.address_local ?? hotel?.address ?? MISSING}.`),
      S("Keep your boarding pass and baggage tags. Take photos of what was inside, and note anything valuable."),
      S("Buy only the essentials you need and keep the receipts. Airlines and insurers often reimburse these."),
      S(`Tell your insurer. Insurance phone: ${ins}${isSampleNo(pack)}.`, ins, "Insurance"),
    ],
    "phone-lost": [
      S("Use another phone or your hotel's phone to lock or erase your phone remotely (Find My on iPhone, Find Hub on Android)."),
      S("Call your mobile operator at home to block the SIM, and ask them to hold your number."),
      S(`If it was stolen, report it to the local police and ask for a written report. Police: ${police}.`, police, "Police"),
      S(`Your insurer will need that report. Insurance phone: ${ins}${isSampleNo(pack)}.`, ins, "Insurance"),
      S("Change the passwords of your email and payment apps, and block or limit any cards saved on the phone."),
      S(`Your trip details are saved in this app on this phone. If you are using another device, sign in with data. Booking reference ${pack.booking.ref}.`),
    ],
    "money-lost": [
      S("Call your bank or card issuer now and block the cards. The number is on the back of the card or in your bank app. Save it before you travel next time."),
      S(`If it was stolen, report it to the police and get a written report. Police: ${police}.`, police, "Police"),
      S(`Tell your hotel (${hotel?.name ?? MISSING}). They can help with a local police report and a phone.`, hotel?.phone, "Hotel"),
      S(`Tell your insurer. Insurance phone: ${ins}${isSampleNo(pack)}.`, ins, "Insurance"),
      S("Ask someone at home to send money through your bank or a licensed money-transfer service. Do not accept help from strangers at ATMs."),
      S(`If you are in real trouble, contact your consulate: ${stay.consulate.name}, or tap SOS to reach a person.`, stay.consulate.phone, "Consulate"),
    ],
    scam: [
      S("Move to a busy, well-lit place. Do not argue and do not follow anyone."),
      S("Do not pay under pressure. If you must pay to leave safely, pay the smallest amount and note the taxi number, plate or shop name."),
      S("If you paid by card, call your bank to dispute the charge. Keep the receipt and take photos."),
      S(`Report it to the local police, or the tourist police if there is one. Police: ${police}. If you feel threatened, call ${general}.`, police, "Police"),
      S(`Tell your hotel (${hotel?.name ?? MISSING}). They can help you report it and get you a safe taxi.`, hotel?.phone, "Hotel"),
      S("If something was stolen, also open the guides for a lost passport, phone or wallet. Tap SOS if you want a person to help."),
    ],
  };
  a.steps = steps[id];
  for (const s of a.steps) if (s.call && hasNumber(s.call)) a.links.push(tel(s.callLabel ?? "Call", s.call));
  a.links.push({ label: "SOS: reach a person", href: `/trips/${pack.booking.ref}/sos`, kind: "page" });
  a.lines = ["Standard guidance. This one is built into the app. It is not one of the six validated rule sets in your guide, but the numbers come from your booking."];
  a.cites = [`Stay in ${stay.cityName}: emergency numbers and consulate`, `Contacts in your booking: airline, insurance, hotel`];
  a.urgent = id !== "lost-luggage";
  a.missing = a.steps.some((s) => s.text.includes(MISSING)) ? ["hotel"] : [];
  a.suggestions = ["What is the police number?", "Where is the Indian embassy?"];
  return a;
}

/* ---------- everyday questions ---------- */

function hotelInfo(env: Env): OaAnswer {
  const { pack, stay } = env;
  const h = pack.places[stay.hotelId];
  const a = blank("hotel", `Your hotel in ${stay.cityName}`);
  if (!h) { a.lines = ["There is no hotel for this city in your saved booking."]; a.low = true; return a; }
  const days = pack.days;
  const inItem = days.flatMap((d) => d.items.map((i) => ({ d, i }))).find(({ i }) => i.type === "hotel" && i.placeId === h.id && /check.?in/i.test(i.title));
  const outItem = days.flatMap((d) => d.items.map((i) => ({ d, i }))).find(({ i }) => i.type === "hotel" && i.placeId === h.id && /check.?out/i.test(i.title));
  a.lines = [
    `${h.name}`,
    `Address: ${h.address}`,
    ...(h.address_local && h.address_local !== h.address ? [`Show this to a driver: ${h.address_local}`] : [`Show this to a driver: ${h.address_local || h.address}`]),
    `Phone: ${h.phone ?? MISSING}${isSampleNo(pack)}`,
    `Check-in: ${fmtDate(stay.from)}${inItem ? ` from ${inItem.i.time}` : " (time is not in your booking)"}.`,
    `Check-out: ${fmtDate(stay.to)}${outItem ? ` by ${outItem.i.time}` : " (time is not in your booking, ask at reception)"}.`,
  ];
  if (pack.stays.length > 1) a.lines.push(`Your other stays: ${pack.stays.filter((s) => s.city !== stay.city).map((s) => `${pack.places[s.hotelId]?.name ?? s.cityName} in ${s.cityName}, ${fmtDate(s.from)} to ${fmtDate(s.to)}`).join("; ")}.`);
  if (h.phone && hasNumber(h.phone)) a.links.push(tel("Call hotel", h.phone));
  a.links.push(mapLink(pack, stay));
  a.cites = [`Your booking: hotel in ${stay.cityName}`, inItem ? `Day ${inItem.d.dayNo}, ${inItem.i.time}: ${inItem.i.title}` : `Stay dates ${fmtDate(stay.from)} to ${fmtDate(stay.to)}`];
  a.suggestions = ["How do I get from the airport to my hotel?", "Where is my pickup?"];
  return a;
}

function flightsInfo(env: Env): OaAnswer {
  const { pack, now, ent } = env;
  const a = blank("flights", "Your flights");
  let list = pack.flights;
  if (ent.flight) list = [ent.flight];
  else if (ent.city) { const iata = pack.places[pack.stays.find((s) => s.city === ent.city)?.airportId ?? ""]?.name.match(/\((\w{3})\)/)?.[1]; if (iata) list = pack.flights.filter((f) => f.from === iata || f.to === iata); }
  if (!list.length) list = pack.flights;
  const next = pack.flights.find((f) => new Date(f.depart_at).getTime() >= now.getTime() - 6 * 3600e3);
  a.lines = list.map((f) => `${f.leg === "outbound" ? "Outbound" : f.leg === "return" ? "Return" : "Between cities"}: ${fmtFlight(f)}${next && f === next ? "  ← next flight" : ""}`);
  a.lines.push("Terminal and gate are not saved in your booking. Check the airport screens, or ask your airline.");
  a.lines.push(`Airline phone: ${pack.contacts.airline_phone}${isSampleNo(pack)}.`);
  if (hasNumber(pack.contacts.airline_phone)) a.links.push(tel(`Call ${pack.contacts.airline}`, pack.contacts.airline_phone));
  a.cites = list.map((f) => `Your booking: flight ${f.flight_no}, code ${f.pnr}`);
  a.suggestions = ["My flight is delayed", "Can I move my flight?"];
  return a;
}

function pickupInfo(env: Env): OaAnswer {
  const { pack, now, stay } = env;
  const { item } = pickupItem(pack, now, stay.city);
  const a = blank("pickup", `Airport pickup in ${stay.cityName}`);
  const d = stay.driver, dd = stay.dropDriver;
  const hotel = pack.places[stay.hotelId];
  a.lines = [
    `${item ? `Pickup: ${fmtDate(item.date)} at ${item.time}` : `Pickup: ${d.pickup_time}`}. Your driver is ${d.name} from ${d.vendor}.`,
    `Pickup code: ${d.pickup_code}. Tell the driver this code, and ask to see theirs.`,
    `Driver phone: ${d.phone}${isSampleNo(pack)}.`,
    `Going to: ${hotel?.name ?? MISSING}.`,
    `Your drop at the end of this stay: driver ${dd.name} from ${dd.vendor}, code ${dd.pickup_code}.`,
  ];
  if (hasNumber(d.phone)) a.links.push(tel(`Call ${d.name}`, d.phone));
  a.links.push(mapLink(pack, stay));
  a.cites = [item ? `Day plan ${fmtDate(item.date)} ${item.time}: ${item.title}` : `Stay in ${stay.cityName}: driver details`, `Booking items: transfers`];
  a.suggestions = ["My driver has not come", "Where is my hotel?"];
  return a;
}

function dayLabel(d: PackDay) { return `Day ${d.dayNo} · ${fmtDate(d.date)} · ${d.cityName}: ${d.title}`; }

function todayInfo(env: Env): OaAnswer {
  const { pack, now, stay, ent } = env;
  const a = blank("today", "Your plan");
  const today = localDate(now, stay.tz);
  const [start, end] = pack.booking.dates;
  let date = ent.date ?? today;
  const askedToday = !ent.date || ent.relative === "today";
  let note = "";
  if (!ent.dayNo && !ent.date || ent.relative === "today") {
    if (date < start) { note = `Your trip starts on ${fmtDate(start)}, in ${daysBetween(date, start)} day${daysBetween(date, start) === 1 ? "" : "s"}. Here is day 1.`; date = start; }
    else if (date > end) { a.lines = [`Your trip ended on ${fmtDate(end)}. Hope it went well.`]; a.cites = [`Your booking: dates ${fmtDate(start)} to ${fmtDate(end)}`]; return a; }
  }
  const day = pack.days.find((d) => d.date === date) ?? pack.days.find((d) => d.dayNo === ent.dayNo);
  if (!day) { a.lines = [`I do not have a plan for ${fmtDate(date)}. Your trip runs ${fmtDate(start)} to ${fmtDate(end)}.`]; a.low = true; return a; }
  const upcomingOnly = askedToday && day.date === today;
  const nowMin = Number(localTime(now, day.tz).slice(0, 2)) * 60 + Number(localTime(now, day.tz).slice(3));
  const items = upcomingOnly ? day.items.filter((i) => Number(i.time.slice(0, 2)) * 60 + Number(i.time.slice(3)) >= nowMin - 15) : day.items;
  if (note) a.lines.push(note);
  a.lines.push(dayLabel(day));
  if (upcomingOnly && !items.length) a.lines.push("Nothing else is planned for the rest of today.");
  for (const i of items) a.lines.push(`${i.time}  ${i.title}${i.notes ? ` (${i.notes})` : ""}`);
  const nextDay = pack.days.find((d) => d.date === addDays(day.date, 1));
  if (upcomingOnly && !items.length && nextDay) a.lines.push(`Tomorrow: ${dayLabel(nextDay)}`);
  a.cites = [`Your booking: ${dayLabel(day)}`];
  a.suggestions = ["What is my plan for tomorrow?", "How do I get to my next stop?"];
  return a;
}
const localTime = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

function bookingInfo(env: Env): OaAnswer {
  const { pack } = env;
  const b = pack.booking;
  const a = blank("booking", `Booking ${b.ref}`);
  a.lines = [
    `${b.title}, from ${b.origin}.`,
    `Dates: ${fmtDate(b.dates[0], true)} to ${fmtDate(b.dates[1], true)}.`,
    `Travellers (${b.pax}): ${b.travellers.length ? b.travellers.join(", ") : "names are added when you pay"}.`,
    `Total: ${inr(b.totalInr)} (sample price, test payment). Status: ${b.status === "confirmed" ? "booked" : "selected, not paid yet"}.`,
    `Cities: ${pack.stays.map((s) => `${s.cityName} (${fmtDate(s.from)} to ${fmtDate(s.to)})`).join(", ")}.`,
  ];
  a.cites = [`Your booking ${b.ref}`];
  a.suggestions = ["What are my flight details?", "Where is my hotel?"];
  return a;
}

function emergencyInfo(env: Env): OaAnswer {
  const { pack, stay } = env;
  const e = stay.emergency;
  const a = blank("emergency", `Emergency numbers in ${stay.cityName}`);
  a.urgent = true;
  a.lines = [
    `General emergency: ${e.general}`,
    `Police: ${e.police}`,
    `Ambulance: ${e.ambulance}`,
    e.verified ? "These numbers were checked for this destination." : "These numbers are not verified. Confirm locally if you can.",
    "Calling an emergency number works with no mobile data. It needs mobile signal.",
  ];
  for (const [l, n] of [["Emergency", e.general], ["Police", e.police], ["Ambulance", e.ambulance]] as const) if (hasNumber(n)) a.links.push(tel(l, n));
  a.links.push({ label: "Open SOS", href: `/trips/${pack.booking.ref}/sos`, kind: "page" });
  a.cites = [`Stay in ${stay.cityName}: emergency numbers`];
  a.suggestions = ["I need a doctor", "Where is the Indian embassy?"];
  return a;
}

function embassyInfo(env: Env): OaAnswer {
  const { stay, pack } = env;
  const c = stay.consulate;
  const a = blank("embassy", `Your consulate in ${stay.cityName}`);
  a.lines = [c.name, `Address: ${c.address}`, `Phone: ${c.phone}${c.sample ? SAMPLE : ""}`, "Opening hours are not saved offline. Call first, or check the official site when you have data."];
  if (hasNumber(c.phone)) a.links.push(tel("Call consulate", c.phone));
  a.cites = [`Stay in ${stay.cityName}: consulate contact`];
  a.suggestions = ["My passport is lost", "What is the police number?"];
  void pack;
  return a;
}

function insuranceInfo(env: Env): OaAnswer {
  const { pack } = env;
  const a = blank("insurance", "Travel insurance");
  a.lines = [`Insurance phone: ${pack.contacts.insurance_phone}${isSampleNo(pack)}.`, "Your policy number is not saved in this app. Keep it in your notes or email."];
  if (hasNumber(pack.contacts.insurance_phone)) a.links.push(tel("Call insurer", pack.contacts.insurance_phone));
  a.cites = ["Your booking: contacts"];
  a.suggestions = ["My luggage did not arrive", "I lost my wallet"];
  return a;
}

function basicsAnswer(env: Env, id: "tipping" | "plug" | "sim" | "currency" | "safety" | "language" | "weather"): OaAnswer {
  const { pack, stay, ent } = env;
  const title = { tipping: "Tipping", plug: "Plugs and power", sim: "SIM, data and Wi-Fi", currency: "Money and currency", safety: "Water and safety", language: "Language", weather: "Weather" }[id];
  const a = blank(id, `${title} in ${stay.cityName}`);
  a.generic = true;
  const cities = ent.city ? [pack.stays.find((s) => s.city === ent.city)!] : [stay];
  const seen = new Set<string>();
  const others = pack.stays.filter((s) => s.city !== cities[0].city);
  for (const s of [...cities, ...others]) {
    const b = basicsFor(s.city);
    if (!b || seen.has(b.country)) continue;
    seen.add(b.country);
    const head = s === cities[0] ? "" : `In ${s.cityName} (${b.country}): `;
    if (id === "weather") { a.lines = ["Weather forecasts are not saved offline, because they change every hour. Open the app with data to see the forecast.", "Packing tip: carry a light layer and a small umbrella, and check the forecast the night before each day."]; break; }
    const text = { tipping: b.tipping, plug: `${b.plug}. Pack a travel adapter; India's plugs will not fit directly.`, sim: b.sim, currency: `${b.currency}. Live exchange rates are not available offline, so I cannot convert amounts. Carry a small amount of local cash and tell your bank before using cards abroad.`, safety: `${b.water} ${b.safety}`, language: `${b.language} Hello: "${b.hello}". Thank you: "${b.thanks}".`, weather: "" }[id];
    a.lines.push(`${head}${text}`);
  }
  if (!a.lines.length) { a.lines = ["I do not have built-in basics for this destination."]; a.low = true; }
  a.cites = id === "weather" ? [`Your booking: cities ${pack.stays.map((s) => s.cityName).join(", ")}`] : [`Built-in travel basics for ${[...seen].join(" and ")} (general guidance, not from your booking)`];
  if (id !== "weather") a.lines.push("General guidance: rules and prices change. Confirm locally.");
  a.suggestions = ["Do I need to tip?", "Which plug adapter do I need?"].filter((q) => !q.toLowerCase().includes(id));
  return a;
}

function routesInfo(env: Env): OaAnswer {
  const { pack, stay, ent } = env;
  const a = blank("routes", "Maps and routes");
  const mine = pack.routes.filter((r) => pack.places[r.from]?.city === stay.city || pack.places[r.to]?.city === stay.city);
  const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  const route = (r: (typeof mine)[number]) => `${r.fromName} to ${r.toName}: ${fmt(r.distance_m)}, about ${Math.round(r.duration_s / 60)} min by ${r.mode === "walk" ? "foot" : "car"}${r.approximate ? " (sample straight-line estimate, not turn-by-turn)" : ""}`;
  if (ent.place) {
    const p = ent.place;
    a.title = `About ${p.name}`;
    const visit = pack.days.flatMap((d) => d.items.filter((i) => i.placeId === p.id).map((i) => ({ d, i })))[0];
    const rs = pack.routes.filter((r) => r.to === p.id || r.from === p.id);
    a.lines = [p.name, p.address ? `Address: ${p.address}` : `Location: ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`];
    if (visit) a.lines.push(`On your plan: ${dayLabel(visit.d)}, ${visit.i.time}.`);
    if (rs.length) { a.lines.push(...rs.map(route)); for (const r of rs.slice(0, 3)) a.links.push({ label: `Route: ${r.fromName.split(" (")[0]} to ${r.toName.split(" (")[0]}`, href: `/trips/${pack.booking.ref}/map?route=${encodeURIComponent(r.id)}`, kind: "map" }); }
    else a.lines.push("There is no saved route for this place. The offline map still shows where it is, and your GPS dot works with no data.");
    a.links.push({ label: "Show on offline map", href: `/trips/${pack.booking.ref}/map?pin=${p.id}`, kind: "map" });
    a.cites = [visit ? `Your booking: ${dayLabel(visit.d)}` : "Your saved places", ...(rs.length ? ["Saved routes in your bundle"] : [])];
    a.suggestions = ["What is my plan for today?", "Where is my hotel?"];
    return a;
  }
  a.lines = mine.length ? ["Saved routes for this stay:", ...mine.slice(0, 8).map(route), "The map and your GPS dot work with no mobile data. There is no live traffic and no address search offline."] : ["No routes are saved for this stay. The offline map still shows your GPS dot."];
  for (const r of mine.slice(0, 4)) a.links.push({ label: `${r.fromName.split(" (")[0]} to ${r.toName.split(" (")[0]}`, href: `/trips/${pack.booking.ref}/map?route=${encodeURIComponent(r.id)}`, kind: "map" });
  a.links.push({ label: "Open offline map", href: `/trips/${pack.booking.ref}/map`, kind: "map" });
  a.cites = ["Saved routes in your bundle", `Stay in ${stay.cityName}`];
  a.suggestions = ["How do I get to my hotel?", "How do I send an SOS?"];
  return a;
}

function sosInfo(env: Env): OaAnswer {
  const { pack, stay } = env;
  const a = blank("sos", "How SOS works");
  a.urgent = true;
  a.lines = [
    `If you are in danger, call ${stay.emergency.general} first.`,
    "Open the SOS screen and tap the big button. Your address card, the nearest hotel and your booking details are attached.",
    "With data: it is sent straight away and a person is paged. Without data: it is saved on this phone and sent when you are back online.",
    `With mobile signal but no data: you can send it as an SMS${pack.contacts.sms_gateway ? ` to ${pack.contacts.sms_gateway}${isSampleNo(pack)}` : ""}. SMS needs cellular signal. It will not send in airplane mode.`,
  ];
  a.links.push({ label: "Open SOS", href: `/trips/${pack.booking.ref}/sos`, kind: "page" }, tel("Emergency", stay.emergency.general));
  a.cites = ["How the SOS screen works in this app", `Stay in ${stay.cityName}: emergency number`];
  a.suggestions = ["What is the police number?", "I need a doctor"];
  return a;
}

function offlineInfo(env: Env): OaAnswer {
  const { pack } = env;
  const a = blank("offline", "What works without internet");
  a.lines = [
    "Works with no data: this assistant, your day plan, flights, hotel and driver details, address cards, the six problem guides, saved routes and the map, your GPS dot, emergency numbers, and queued SOS.",
    "Needs a connection: booking or changing anything, live prices, live flight status, the online Trip agent, and sending an SOS (it is queued until you are online or on SMS).",
    `Saved on this phone: version ${pack.packVersion}, built ${new Date(pack.builtAt).toDateString()}. ${pack.rulesMeta.label}.`,
    pack.disclaimer,
  ];
  a.cites = [`Your offline bundle v${pack.packVersion}`];
  a.suggestions = ["How do I send an SOS?", "What can you do?"];
  return a;
}

function changeInfo(env: Env): OaAnswer {
  const { pack, stay } = env;
  const a = blank("change", "Changes need a connection");
  a.needsOnline = true;
  a.lines = [
    "I cannot book, change, extend or cancel anything. This assistant only reads your saved booking.",
    "To change a flight: when you are online, ask the Trip agent for \"Change my flight\". It opens MakeMyTrip, Goibibo, Cleartrip or ixigo (log in there yourself, we never see your password), then you record the new flight and tap Confirm. Hotel stays are changed through the agent too.",
    `Until then you can call your airline (${pack.contacts.airline}, ${pack.contacts.airline_phone}${isSampleNo(pack)}) or your hotel.`,
  ];
  if (hasNumber(pack.contacts.airline_phone)) a.links.push(tel("Call airline", pack.contacts.airline_phone));
  const h = pack.places[stay.hotelId];
  if (h?.phone && hasNumber(h.phone)) a.links.push(tel("Call hotel", h.phone));
  a.cites = ["How changes work: online only, with your Confirm tap", "Your booking: contacts"];
  a.suggestions = ["What are my flight details?", "My flight is delayed"];
  return a;
}

function helpInfo(): OaAnswer {
  const a = blank("help", "What I can help with offline");
  a.lines = [
    "I am a rule-based assistant that runs on your phone. I am not an AI model, and I only use your saved booking and built-in guides.",
    "Ask me about: your hotel, flights, airport pickup, today's or tomorrow's plan, routes and the map, emergency numbers, your consulate, insurance, currency, tipping, plugs, SIM and Wi-Fi, safety, and the SOS screen.",
    "Problems I can walk you through step by step: lost passport, flight delayed, missed connection, hotel has no booking, driver not here, medical help, missing luggage, lost phone or wallet, and scams.",
    "I can also understand a little Hindi-English, like \"passport kho gaya\" or \"hotel kahan hai\".",
    "I cannot make changes. Those need a connection and your Confirm tap.",
  ];
  a.cites = ["Offline assistant: built into this app"];
  a.suggestions = ["Where is my hotel?", "When is my airport pickup?", "My passport is lost", "What is the police number?"];
  return a;
}

function thanksInfo(): OaAnswer {
  const a = blank("thanks", "You are welcome");
  a.lines = ["Happy to help. Stay safe, and enjoy the trip."];
  a.suggestions = ["What is my plan for today?"];
  return a;
}

export function build(env: Env, intent: IntentId): OaAnswer {
  switch (intent) {
    case "lost-passport": case "flight-delayed": case "missed-connection": case "hotel-not-found": case "transfer-no-show": case "medical-help":
      return guidance(env, intent) ?? blank(intent, "Not in your guide");
    case "lost-luggage": case "phone-lost": case "money-lost": case "scam": return standard(env, intent);
    case "hotel": return hotelInfo(env);
    case "flights": return flightsInfo(env);
    case "pickup": return pickupInfo(env);
    case "today": return todayInfo(env);
    case "booking": return bookingInfo(env);
    case "emergency": return emergencyInfo(env);
    case "embassy": return embassyInfo(env);
    case "insurance": return insuranceInfo(env);
    case "tipping": case "plug": case "sim": case "currency": case "safety": case "language": case "weather": return basicsAnswer(env, intent);
    case "routes": return routesInfo(env);
    case "sos": return sosInfo(env);
    case "offline": return offlineInfo(env);
    case "change": return changeInfo(env);
    case "thanks": return thanksInfo();
    default: return helpInfo();
  }
}

export function lowAnswer(question: string, alts: IntentId[]): OaAnswer {
  const a = blank("none", "I can't answer that offline");
  a.low = true;
  a.confidence = 0.1;
  a.lines = [
    question.trim() ? "I could not match that to anything in your saved booking or my built-in guides." : "Type a question and I will look in your saved booking.",
    "When you have data, the online Trip agent can answer more. You can queue this question for it.",
  ];
  a.suggestions = [...new Set([...alts.map(exampleFor), "Where is my hotel?", "When is my airport pickup?", "What is the police number?", "What can you do?"])].filter(Boolean).slice(0, 5);
  a.cites = [];
  return a;
}
