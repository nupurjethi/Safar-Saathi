import type { IntentId } from "./types";
import { patternTokens, phraseMatch, tokens } from "./text";

/**
 * Intent table. A rule is a weight plus one or more GROUPS; every group must hit (a group hits when any of its
 * "|"-separated phrases matches). A trailing "*" is a prefix wildcard. Typos are tolerated by `tokMatch`.
 * Hinglish words (kho, gum, chori, nahi, kahan, paisa, madad ...) sit next to the English ones.
 */
type Rule = { w: number; groups: string[][] };
export type IntentDef = { id: IntentId; rules: Rule[]; example: string };

const r = (w: number, ...groups: string[]): Rule => ({ w, groups: groups.map((g) => g.split("|")) });

export const INTENTS: IntentDef[] = [
  // ---- the six frozen scenarios (answers come from the rule set saved in the pack) ----
  { id: "lost-passport", example: "My passport is lost", rules: [
    r(7, "passport|pasport|visa|travel document", "lost|lose|losing|stolen|stole|theft|missing|misplaced|kho|khoya|khogaya|gum|chori|chura|chhin*|nahi mil*|cant find|left behind"),
    r(6, "passport kho|passport gum|passport chori|passport lost|passport stolen|lost my passport|lost passport"),
  ] },
  { id: "flight-delayed", example: "My flight is delayed", rules: [
    r(7, "flight|airplane|airline|boarding|udaan|flight no*", "delay*|=late|=cancelled|=canceled|postponed|retimed|rescheduled|deri|diverted"),
    r(6, "flight delayed|delayed flight|flight is late|flight =cancelled|flight =canceled|flight late|delay ho"),
    r(4, "delayed|delay"),
  ] },
  { id: "missed-connection", example: "I missed my connecting flight", rules: [
    r(7, "missed|miss|misssed|chhut*|chhoot*|chut*|nikal gayi|nikal gaya", "flight|connection|airplane|connecting|layover|udaan|train"),
    r(6, "missed my flight|missed connection|missed the flight|miss my flight|flight miss|flight chhut*|missed my connection"),
  ] },
  { id: "hotel-not-found", example: "My hotel has no booking for me", rules: [
    r(7, "hotel|booking|room|reservation|accommodation|property", "overbooked|over booked|no booking|no reservation|not found|cant find|cannot find|couldnt find|not on the list|doesnt exist|refused|denied|no room|no rooms|full|nahi mil*|nahi hai|closed|wrong address|cant locate|not able to find|mil nahi"),
    r(6, "overbooked|over booked|overbook*"),
    r(6, "hotel kahan hai nahi mil*|hotel nahi mil*|hotel nahi mila|hotel mila nahi"),
  ] },
  { id: "transfer-no-show", example: "My driver has not come", rules: [
    r(7, "driver|pickup|pick up|cab|taxi|transfer|chauffeur|car", "not here|not came|didnt come|not coming|no show|noshow|not arrived|didnt arrive|not turned|never came|waiting|cant find|cannot find|nahi aaya|nahi aya|nahi aa*|kahan hai|hasnt come|has not come|not there|isnt here|is not here|nowhere|missing"),
    r(6, "driver late|pickup late|cab late|driver not|pickup not"),
  ] },
  { id: "medical-help", example: "I feel sick, I need a doctor", rules: [
    r(7, "medical emergency|ambulance|heart attack|chest pain|unconscious|bleeding|accident|seizure|cant breathe|injured|injury|hurt|doctor|hospital|dard|bimar|tabiyat kharab|poison*|asthma"),
    r(5, "sick|unwell|fever|vomit*|nausea|pharmacy|medicine|medication|dawai|dawa|allergy|allergic|stomach|headache|bukhar|ulti|clinic|not feeling well|ill"),
  ] },
  // ---- extra problem intents (standard guidance built into the app, clearly labelled) ----
  { id: "lost-luggage", example: "My luggage did not arrive", rules: [
    r(7, "luggage|baggage|suitcase|bags|bag|checked bag|trolley|belt|carousel", "lost|missing|not arrived|didnt arrive|didnt come|not come|delayed|damaged|nahi aaya|nahi aya|gum|kho*|not on the belt|not here"),
  ] },
  { id: "phone-lost", example: "My phone was stolen", rules: [
    r(7, "phone|mobile|iphone|smartphone|cellphone|handset", "lost|stolen|snatched|theft|missing|kho*|gum|chori|left|misplaced|chhin*|nahi mil*|dropped"),
  ] },
  { id: "money-lost", example: "I lost my wallet", rules: [
    r(7, "wallet|purse|money|cash|card|cards|credit card|debit card|atm card|paisa|paise|paisay|handbag", "lost|stolen|snatched|theft|missing|kho*|gum|chori|misplaced|chhin*|nahi mil*|blocked|swallowed|declined"),
  ] },
  { id: "scam", example: "I think I was scammed by a taxi", rules: [
    r(7, "scam*|cheat*|fraud|overcharg*|ripped off|rip off|fake|thag*|dhoka|dhokha|pickpocket*|robbed|robbery|mugged|harass*|unsafe|followed|touts?|con man|tout|extort*|forced me"),
    r(5, "meter|overcharged|charged too much|too expensive|bargain"),
  ] },
  // ---- everyday questions answered from the saved booking ----
  { id: "hotel", example: "Where is my hotel?", rules: [
    r(6, "hotel|stay|staying|room|accommodation|address|check in|checkin|check out|checkout|reception|kahan ruk*|kahan rehna|hotel kahan|rehna|lodging"),
  ] },
  { id: "flights", example: "What are my flight details?", rules: [
    r(6, "flight|flights|airplane|pnr|airline|boarding|departure|arrival|depart|arrive|udaan|terminal|gate|flight number|when do we fly|jaana|landing|land|airport code|carrier"),
  ] },
  { id: "pickup", example: "When is my airport pickup?", rules: [
    r(6.5, "pickup|pick up|driver|airport transfer|cab|taxi|transfer|chauffeur|lene aayega|who will pick|pickup code|pick me|vehicle"),
  ] },
  { id: "today", example: "What is my plan for today?", rules: [
    r(6, "whats next|what is next|next activity|todays plan|today's plan|what is the plan|what is on|what do we do|what are we doing|what to do|day plan|kya plan|aaj ka plan|kal ka plan"),
    r(5, "today|tomorrow|aaj|kal|parso|tonight|next|upcoming|schedule|agenda|itinerary|activities|sightseeing|programme|program|plan"),
    r(5.5, "day 1|day 2|day 3|day 4|day 5|day 6|day 7|day 8|day 9|day 10"),
  ] },
  { id: "booking", example: "What is my booking reference?", rules: [
    r(6, "booking details|trip details|trip summary|my booking|booking ref*|reference number|booking number|booking id|total cost|how much did i pay|total paid|who is travelling|who is traveling|how many travellers|how many travelers|how many people|dates of my trip|trip dates|when does my trip|when do we leave|kitne log|travellers|travelers|passengers|my trip"),
    r(4, "booking|reservation|reference|ref|paid|payment"),
  ] },
  { id: "emergency", example: "What is the police number?", rules: [
    r(8, "police|ambulance|fire brigade|fire|emergency|112|911|999|100|108", "number|numbers|no|phone|dial|contact|helpline|kya hai|kitna|which"),
    r(5, "emergency number*|police number|ambulance number|helpline|police|emergency|112|911"),
  ] },
  { id: "embassy", example: "Where is the Indian embassy?", rules: [ r(7, "embassy|consulate|high commission|consular|indian mission|dootavas|embassy address|consulate address") ] },
  { id: "insurance", example: "What is my insurance number?", rules: [ r(7, "insurance|insured|claim|policy|travel insurance|bima") ] },
  // ---- general travel basics (built in, per country) ----
  { id: "tipping", example: "Do I need to tip?", rules: [ r(7, "tip|tips|tipping|gratuity|service charge|baksheesh|tip dena") ] },
  { id: "plug", example: "Which plug adapter do I need?", rules: [ r(7, "plug|plugs|adapter|adaptor|socket|voltage|charger|charging|power outlet|power converter|voltage converter|socket type|bijli|power socket") ] },
  { id: "sim", example: "How do I get a local SIM or Wi-Fi?", rules: [ r(7, "sim|esim|e sim|roaming|mobile data|data plan|internet|wifi|wi fi|hotspot|data pack|local sim|international roaming|phone plan|network") ] },
  { id: "currency", example: "What currency do they use?", rules: [ r(6, "currency|forex|exchange rate|exchange|cash|money|atm|cards|credit card|debit card|paisa|paise|rupee*|inr|dollar*|euro*|how much cash|local money|change money|currency exchange|pound*|baht|dirham*|yen|sgd|usd|eur|aed|thb|jpy|convert|rate") ] },
  { id: "safety", example: "Is tap water safe? Any safety tips?", rules: [
    r(6, "tap water|drink water|water safe|safe to drink|safety|travel tips|street food|crime|walk alone|local laws|dress code|etiquette|customs|safe for women|solo travel|is it safe|safe to walk|water"),
    r(4, "safe"),
  ] },
  { id: "language", example: "How do I say hello in the local language?", rules: [ r(7, "language|speak|english|hello in|how to say|local language|phrase|phrases|translate|say thank you|say hello|bhasha|bolte") ] },
  { id: "weather", example: "What is the weather?", rules: [ r(7, "weather|temperature|rain|forecast|climate|mausam|umbrella|what to wear|packing|hot|cold") ] },
  // ---- how the app works ----
  { id: "routes", example: "How do I get to the Colosseum?", rules: [
    r(6, "map|route|routes|directions|navigate|navigation|gps|how do i get|how to get|way to|raasta|rasta|walk to|distance|how far|kitna door|reach|get to|go to|nearest"),
  ] },
  { id: "sos", example: "How do I send an SOS?", rules: [
    r(8, "sos|panic|emergency button|send sos|alert|how to send sos|sms sos"),
    r(4, "help me|need help|i need help|urgent|danger|bachao|madad|in trouble|help"),
  ] },
  { id: "offline", example: "What works without internet?", rules: [
    r(8, "what works offline|offline mode|without internet|no internet|no network|airplane mode|works offline|offline features|without data|no signal|no data|how to use|how does this work|offline guide|offline map|saved on my phone|version|update|sync|download|storage|bundle"),
  ] },
  { id: "change", example: "Can I move my flight?", rules: [
    r(6.5, "change|move|extend|reschedule|rebook|modify|refund|upgrade|cancel|prepone|postpone|add a night|add night|book another|book a|extra night|shift", "flight|hotel|booking|stay|trip|night|ticket|pickup|transfer|date|room|activity|tour"),
    r(6, "cancel my|change my|move my|extend my|reschedule my|refund my"),
    r(6.5, "refund|reschedule|rebook|prepone|extend|upgrade"),
  ] },
  { id: "help", example: "What can you do?", rules: [
    r(7, "what can you do|what do you do|how can you help|what can i ask|kya kar sakte|kya puch|help menu|capabilities|who are you|what are you|what can i do"),
    r(3, "hello|hi|hey|namaste|help|hii|hlo"),
  ] },
  { id: "thanks", example: "Thanks!", rules: [ r(5, "thanks|thank you|thx|shukriya|dhanyavaad|dhanyavad|ok thanks|great thanks|cool") ] },
];

export type Scored = { id: IntentId; score: number };

/** Scores every intent for a question. Score = best rule weight + a small bonus for longer, more specific matches. */
export function scoreIntents(question: string): Scored[] {
  const qt = tokens(question);
  const out: Scored[] = [];
  for (const it of INTENTS) {
    let best = 0, matchedRules = 0;
    for (const rule of it.rules) {
      let spec = 0, ok = true;
      for (const g of rule.groups) {
        let hit = 0;
        for (const p of g) { const pt = patternTokens(p); if (pt.length) hit = Math.max(hit, phraseMatch(qt, pt)); }
        if (!hit) { ok = false; break; }
        spec += hit;
      }
      if (ok) { matchedRules++; best = Math.max(best, rule.w + 0.1 * spec); }
    }
    if (best > 0) out.push({ id: it.id, score: best + 0.2 * (matchedRules - 1) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export const exampleFor = (id: IntentId) => INTENTS.find((i) => i.id === id)?.example ?? "";
