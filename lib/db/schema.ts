import {
  customType,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  date,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------ Catalogue ------------------------------ */

export const destinations = pgTable("destinations", {
  id: id(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  iso2: varchar("iso2", { length: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  timezone: text("timezone").notNull(),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLon: doublePrecision("center_lon").notNull(),
  airportIata: varchar("airport_iata", { length: 3 }).notNull(),
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: jsonb("bbox").$type<[number, number, number, number]>().notNull(),
  pmtilesUrl: text("pmtiles_url"),
  /** A real, openly licensed photo of a landmark in this destination (local file under /public/places). */
  heroImage: text("hero_image"),
  heroCredit: jsonb("hero_credit").$type<ImageCredit>(),
  emergencyNumbers: jsonb("emergency_numbers").$type<EmergencyNumbers>().notNull(),
  consulate: jsonb("consulate").$type<Consulate>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pois = pgTable(
  "pois",
  {
    id: id(),
    destinationId: uuid("destination_id").notNull().references(() => destinations.id),
    name: text("name").notNull(),
    nameLocal: text("name_local"),
    category: varchar("category", { length: 24 }).notNull(), // airport | hotel | sight | food | station | pickup
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    address: text("address"),
    addressLocal: text("address_local"),
    /** Real photo of this landmark (Wikimedia Commons, license-checked). Null for fictional hotels. */
    imageFile: text("image_file"),
    imageCredit: jsonb("image_credit").$type<ImageCredit>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pois_dest_idx").on(t.destinationId)],
);

export const itineraries = pgTable(
  "itineraries",
  {
    id: id(),
    slug: varchar("slug", { length: 96 }).notNull().unique(),
    title: text("title").notNull(),
    theme: varchar("theme", { length: 16 }).notNull(), // beach culture adventure family honeymoon
    tier: varchar("tier", { length: 12 }).notNull(), // budget standard premium
    nights: integer("nights").notNull(),
    originCity: varchar("origin_city", { length: 3 }).notNull(),
    cities: jsonb("cities").$type<string[]>().notNull(), // destination slugs in order
    pricePerPersonInr: integer("price_per_person_inr").notNull(),
    ratingSample: doublePrecision("rating_sample").notNull(),
    heroPalette: jsonb("hero_palette").$type<[string, string]>().notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    summary: text("summary").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("itin_theme_idx").on(t.theme), index("itin_tier_idx").on(t.tier)],
);

export const itineraryDays = pgTable(
  "itinerary_days",
  {
    id: id(),
    itineraryId: uuid("itinerary_id").notNull().references(() => itineraries.id),
    dayNo: integer("day_no").notNull(),
    cityDestinationId: uuid("city_destination_id").notNull().references(() => destinations.id),
    title: text("title").notNull(),
    items: jsonb("items").$type<DayItem[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("itin_day_uq").on(t.itineraryId, t.dayNo)],
);

export const flights = pgTable(
  "flights",
  {
    id: id(),
    flightNo: varchar("flight_no", { length: 10 }).notNull(),
    carrierName: text("carrier_name").notNull(),
    fromIata: varchar("from_iata", { length: 3 }).notNull(),
    toIata: varchar("to_iata", { length: 3 }).notNull(),
    departAt: ts("depart_at").notNull(),
    arriveAt: ts("arrive_at").notNull(),
    fareInr: integer("fare_inr").notNull(),
    seatsLeft: integer("seats_left").notNull(),
    changeFeeInr: integer("change_fee_inr").notNull(),
    fareRules: jsonb("fare_rules").$type<FareRules>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("flights_route_idx").on(t.fromIata, t.toIata, t.departAt)],
);

export const hotels = pgTable(
  "hotels",
  {
    /** Same UUID as the matching POI row (category = hotel). */
    id: uuid("id").primaryKey(),
    destinationId: uuid("destination_id").notNull().references(() => destinations.id),
    name: text("name").notNull(),
    stars: integer("stars").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    address: text("address").notNull(),
    addressLocal: text("address_local").notNull(),
    phoneSample: text("phone_sample").notNull(),
    checkinTime: varchar("checkin_time", { length: 5 }).notNull(),
    checkoutTime: varchar("checkout_time", { length: 5 }).notNull(),
    rules: jsonb("rules").$type<string[]>().notNull(),
    nightlyBaseInr: integer("nightly_base_inr").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("hotels_dest_idx").on(t.destinationId)],
);

export const roomInventory = pgTable(
  "room_inventory",
  {
    id: id(),
    hotelId: uuid("hotel_id").notNull().references(() => hotels.id),
    date: date("date", { mode: "string" }).notNull(),
    roomType: varchar("room_type", { length: 24 }).notNull(),
    priceInr: integer("price_inr").notNull(),
    roomsLeft: integer("rooms_left").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("room_inv_uq").on(t.hotelId, t.date, t.roomType)],
);

export const transfers = pgTable("transfers", {
  id: id(),
  destinationId: uuid("destination_id").notNull().references(() => destinations.id),
  type: varchar("type", { length: 8 }).notNull(), // pickup | drop
  fromPoiId: uuid("from_poi_id").notNull().references(() => pois.id),
  toPoiId: uuid("to_poi_id").notNull().references(() => pois.id),
  vendorName: text("vendor_name").notNull(),
  driverName: text("driver_name").notNull(),
  driverPhoneSample: text("driver_phone_sample").notNull(),
  pickupCode: varchar("pickup_code", { length: 12 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------- Booking ------------------------------- */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phoneE164: text("phone_e164"),
  /** scrypt hash (lib/server/password.ts). Null for demo accounts and email-code accounts. Never returned by any API. */
  passwordHash: text("password_hash"),
  role: varchar("role", { length: 12 }).notNull().default("traveller"), // traveller | agent | admin
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const travellers = pgTable("travellers", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  bookingId: uuid("booking_id"),
  name: text("name").notNull(),
  ageBand: varchar("age_band", { length: 12 }).notNull(), // child teen adult senior
  passportLast4: varchar("passport_last4", { length: 4 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    ref: varchar("ref", { length: 10 }).notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id),
    /** Catalogue trips point at an itinerary. Uploaded travel plans (source "upload") have none and point at a travel plan instead. */
    itineraryId: uuid("itinerary_id").references(() => itineraries.id),
    planId: uuid("plan_id").references(() => travelPlans.id),
    source: varchar("source", { length: 12 }).notNull().default("catalogue"), // catalogue | upload
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    pax: integer("pax").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"), // draft (selected, unpaid) | confirmed
    totalInr: integer("total_inr").notNull(),
    packVersion: integer("pack_version").notNull().default(0),
    insurancePhoneSample: text("insurance_phone_sample"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bookings_user_idx").on(t.userId)],
);

export const bookingItems = pgTable(
  "booking_items",
  {
    id: id(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    kind: varchar("kind", { length: 12 }).notNull(), // flight hotel transfer activity
    refId: uuid("ref_id"),
    date: date("date", { mode: "string" }).notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    priceInr: integer("price_inr").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"), // confirmed | replaced | cancelled
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("booking_items_booking_idx").on(t.bookingId)],
);

export const payments = pgTable("payments", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  method: varchar("method", { length: 12 }).notNull().default("dummy"),
  amountInr: integer("amount_inr").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("paid"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A travel plan the traveller uploaded (PDF, Word, Excel, images...). Gemini reads it; the offline bundle is built from it. */
export const travelPlans = pgTable("travel_plans", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  bookingId: uuid("booking_id"), // the trip created from this plan (no FK: bookings.plan_id points back here)
  title: text("title").notNull().default("My travel plan"),
  status: varchar("status", { length: 16 }).notNull().default("uploading"), // uploading | processing | ready | failed
  /** Structured plan extracted by the model (lib/plans/schema.ts). The raw documents are NOT kept after processing. */
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  model: text("model"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One uploaded file. Its text (or image) is held only until the plan is processed, then cleared. */
export const planFiles = pgTable("plan_files", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => travelPlans.id),
  name: text("name").notNull(),
  mime: varchar("mime", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 12 }).notNull(), // pdf | word | sheet | image | text | unsupported
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("parsed"), // parsed | skipped
  note: text("note"),
  text: text("text"),
  imageDataUrl: text("image_data_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Mock partner price rules (sample data): how each booking platform marks up the mock base fare or room rate. */
export const partnerMarkups = pgTable(
  "partner_markups",
  {
    id: id(),
    platform: varchar("platform", { length: 16 }).notNull(), // makemytrip | goibibo | cleartrip | ixigo
    kind: varchar("kind", { length: 8 }).notNull(), // flight | hotel
    markupBps: integer("markup_bps").notNull(), // basis points over the mock base price (e.g. 350 = 3.5%)
    feeInr: integer("fee_inr").notNull(), // convenience fee per booking
    discountBps: integer("discount_bps").notNull().default(0),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("partner_markup_uq").on(t.platform, t.kind)],
);

/**
 * Mock hotels the mock partner API generates on demand for places outside the seeded catalogue (e.g. cities from an
 * uploaded travel plan). Sample data, deterministic per area. Seeded catalogue hotels stay in `hotels`.
 */
export const mockHotels = pgTable(
  "mock_hotels",
  {
    id: id(),
    areaKey: varchar("area_key", { length: 40 }).notNull(), // lat,lon rounded to 0.1 degree
    cityName: text("city_name").notNull(),
    name: text("name").notNull(),
    stars: integer("stars").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    address: text("address").notNull(),
    nightlyBaseInr: integer("nightly_base_inr").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("mock_hotels_area_idx").on(t.areaKey)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Offline street-map files (PMTiles) generated on demand for cities in uploaded plans that our pre-built tiles do not cover. */
export const mapTiles = pgTable("map_tiles", {
  id: id(),
  key: varchar("key", { length: 80 }).notNull().unique(), // e.g. plan-<uuid>-goa
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  bbox: jsonb("bbox").$type<[number, number, number, number]>().notNull(),
  maxZoom: integer("max_zoom").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which booking platforms a traveller says they are logged in to (self-declared; we never see their account or password). */
export const providerConnections = pgTable(
  "provider_connections",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: varchar("provider", { length: 16 }).notNull(), // makemytrip | goibibo | cleartrip | ixigo
    status: varchar("status", { length: 12 }).notNull().default("connected"),
    markedAt: ts("marked_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("provider_conn_user_uq").on(t.userId, t.provider)],
);

/* ----------------------------- Agent + safety ---------------------------- */

export const agentThreads = pgTable("agent_threads", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  channel: varchar("channel", { length: 8 }).notNull().default("app"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: id(),
    threadId: uuid("thread_id").notNull().references(() => agentThreads.id),
    role: varchar("role", { length: 12 }).notNull(), // user | assistant
    content: text("content").notNull(),
    parts: jsonb("parts").$type<unknown[]>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agent_msgs_thread_idx").on(t.threadId)],
);

/** The action log: every tool call the agent makes, plus human confirm/decline events. */
export const toolCalls = pgTable(
  "tool_calls",
  {
    id: id(),
    threadId: uuid("thread_id").references(() => agentThreads.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    tool: varchar("tool", { length: 40 }).notNull(),
    input: jsonb("input").$type<unknown>().notNull(),
    output: jsonb("output").$type<unknown>(),
    status: varchar("status", { length: 12 }).notNull().default("ok"), // ok | error | blocked
    provider: varchar("provider", { length: 24 }),
    source: text("source"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tool_calls_booking_idx").on(t.bookingId)],
);

export const changeQuotes = pgTable("change_quotes", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: varchar("kind", { length: 16 }).notNull(), // flight_change | hotel_extend
  /** What the change targets, e.g. { itemId, newFlightId } or { hotelItemId, extraNights } */
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  before: jsonb("before").$type<Record<string, unknown>>().notNull(),
  after: jsonb("after").$type<Record<string, unknown>>().notNull(),
  priceDeltaInr: integer("price_delta_inr").notNull(),
  rules: jsonb("rules").$type<string[]>().notNull(),
  status: varchar("status", { length: 12 }).notNull().default("open"), // open | applied | declined | void | expired
  chaos: varchar("chaos", { length: 16 }),
  expiresAt: ts("expires_at").notNull(),
  quoteHash: text("quote_hash").notNull(),
  source: text("source").notNull().default("Sample data (mock API)"),
  breakup: jsonb("breakup").$type<{ label: string; amountInr: number }[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const confirmations = pgTable("confirmations", {
  id: id(),
  quoteId: uuid("quote_id").notNull().references(() => changeQuotes.id),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cases = pgTable("cases", {
  id: id(),
  caseRef: varchar("case_ref", { length: 16 }).notNull().unique(), // SS-C-1042
  bookingId: uuid("booking_id").references(() => bookings.id),
  channel: varchar("channel", { length: 8 }).notNull(),
  severity: integer("severity").notNull(),
  summary: text("summary").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("open"), // open | taken | closed
  assignedTo: text("assigned_to"),
  slaDueAt: ts("sla_due_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: id(),
    providerMessageId: text("provider_message_id"),
    direction: varchar("direction", { length: 8 }).notNull(), // in | out
    fromMasked: text("from_masked").notNull(),
    body: text("body").notNull(),
    caseId: uuid("case_id").references(() => cases.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sms_provider_msg_uq").on(t.providerMessageId, t.direction)],
);

/* -------------------------------- Offline -------------------------------- */

export const offlinePacks = pgTable(
  "offline_packs",
  {
    id: id(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: varchar("status", { length: 12 }).notNull().default("active"),
    manifest: jsonb("manifest").$type<unknown>().notNull(),
    pack: jsonb("pack").$type<unknown>().notNull(),
    builtAt: ts("built_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("packs_booking_version_uq").on(t.bookingId, t.version)],
);

/* ------------------- selection, rules, providers (revision v2) ------------------- */

/** A trip the traveller selected from the catalogue. Offline setup starts here, before payment. */
export const tripDrafts = pgTable("trip_drafts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  itineraryId: uuid("itinerary_id").notNull().references(() => itineraries.id),
  bookingId: uuid("booking_id").references(() => bookings.id), // the draft/confirmed booking holding the plan
  status: varchar("status", { length: 12 }).notNull().default("preparing"), // preparing | ready | booked
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every version of the trip data, with the change that produced it. */
export const tripVersions = pgTable(
  "trip_versions",
  {
    id: id(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    version: integer("version").notNull(),
    change: text("change").notNull(),
    dataHash: text("data_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("trip_versions_uq").on(t.bookingId, t.version)],
);

/** LLM or template rule sets. Frozen once validated: never edited afterwards. */
export const ruleSets = pgTable(
  "rule_sets",
  {
    id: id(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    tripVersion: integer("trip_version").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    sourceHash: text("source_hash").notNull(),
    status: varchar("status", { length: 12 }).notNull().default("draft"), // draft | validated | failed | active
    origin: varchar("origin", { length: 12 }).notNull(), // llm | template | mixed
    generatedBy: jsonb("generated_by").$type<Record<string, unknown>>().notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rule_sets_booking_idx").on(t.bookingId)],
);

export const ruleValidations = pgTable("rule_validations", {
  id: id(),
  ruleSetId: uuid("rule_set_id").notNull().references(() => ruleSets.id),
  check: varchar("check_name", { length: 32 }).notNull(),
  passed: boolean("passed").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const providerOffers = pgTable("provider_offers", {
  id: id(),
  provider: varchar("provider", { length: 24 }).notNull(),
  kind: varchar("kind", { length: 8 }).notNull(), // flight | stay
  payload: jsonb("payload").$type<unknown>().notNull(),
  breakup: jsonb("breakup").$type<{ label: string; amountInr: number }[]>().notNull(),
  validUntil: ts("valid_until").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const priceBreakups = pgTable("price_breakups", {
  id: id(),
  quoteId: uuid("quote_id").notNull().references(() => changeQuotes.id),
  label: text("label").notNull(),
  amountInr: integer("amount_inr").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** SOS cases queued on the phone and uploaded when the network returns. Idempotent by local id. */
export const sosCasesLocalSync = pgTable(
  "sos_cases_local_sync",
  {
    id: id(),
    localId: text("local_id").notNull(),
    caseId: uuid("case_id").references(() => cases.id),
    caseRef: varchar("case_ref", { length: 16 }),
    queuedAt: ts("queued_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sos_local_uq").on(t.localId)],
);

/** Email one-time codes (hashed). Auth.js-compatible swap point: see README. */
export const loginCodes = pgTable("login_codes", {
  id: id(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------- Analytics ------------------------------- */

export const events = pgTable("events", {
  id: id(),
  name: varchar("name", { length: 48 }).notNull(),
  userId: uuid("user_id"),
  bookingId: uuid("booking_id"),
  props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------- Types --------------------------------- */

export type ImageCredit = { title: string; author: string; license: string; licenseUrl: string; sourceUrl: string; pageUrl: string };
export type EmergencyNumbers = { general: string; police: string; ambulance: string; verified: boolean };
export type Consulate = { name: string; address: string; phone: string; sample: true };
export type FareRules = { changeAllowed: boolean; changeFeeInr: number; fareDifferenceApplies: boolean; notes: string };
export type DayItem = {
  time: string; // HH:mm local
  type: "flight" | "transfer" | "hotel" | "activity" | "meal" | "free";
  poiId?: string;
  title: string;
  notes?: string;
};
