/**
 * Static source data for the deterministic seed generator.
 * Coordinates are real public landmarks (approximate, 4 d.p.). Everything else
 * (hotels, vendors, phone numbers, consulate contacts) is FICTIONAL SAMPLE data.
 */

export type Region = "gulf" | "sea" | "east-asia" | "south-asia" | "europe" | "oceania";
export type Theme = "beach" | "culture" | "adventure" | "family" | "honeymoon";

export type PoiSeed = { name: string; local: string; lat: number; lon: number };

export type DestSeed = {
  slug: string;
  name: string;
  country: string;
  iso2: string;
  currency: string;
  timezone: string;
  center: [number, number]; // lat, lon
  iata: string;
  airport: { name: string; lat: number; lon: number; local: string };
  localCity: string;
  localStreet: string;
  emergency: { general: string; police: string; ambulance: string; verified: boolean };
  region: Region;
  themes: Theme[];
  /** Base nightly INR for a 4-star room. */
  cost: number;
  pois: PoiSeed[];
  /** Optional fixed spots (lat, lon) for the 3/4/5-star hotels instead of landmark-anchored ones. */
  hotelAnchors?: { lat: number; lon: number }[];
};

const p = (name: string, local: string, lat: number, lon: number): PoiSeed => ({ name, local, lat, lon });

export const ORIGINS: Record<string, { name: string; lat: number; lon: number; tz: string; city: string }> = {
  DEL: { name: "Delhi", lat: 28.5562, lon: 77.1, tz: "Asia/Kolkata", city: "Delhi" },
  BOM: { name: "Mumbai", lat: 19.0896, lon: 72.8656, tz: "Asia/Kolkata", city: "Mumbai" },
  BLR: { name: "Bengaluru", lat: 13.1986, lon: 77.7066, tz: "Asia/Kolkata", city: "Bengaluru" },
  MAA: { name: "Chennai", lat: 12.9941, lon: 80.1709, tz: "Asia/Kolkata", city: "Chennai" },
  HYD: { name: "Hyderabad", lat: 17.2403, lon: 78.4294, tz: "Asia/Kolkata", city: "Hyderabad" },
  CCU: { name: "Kolkata", lat: 22.6547, lon: 88.4467, tz: "Asia/Kolkata", city: "Kolkata" },
  PNQ: { name: "Pune", lat: 18.5822, lon: 73.9197, tz: "Asia/Kolkata", city: "Pune" },
  AMD: { name: "Ahmedabad", lat: 23.0772, lon: 72.6347, tz: "Asia/Kolkata", city: "Ahmedabad" },
};
export const ORIGIN_CODES = Object.keys(ORIGINS);

export const DESTINATIONS: DestSeed[] = [
  {
    slug: "dubai", name: "Dubai", country: "United Arab Emirates", iso2: "AE", currency: "AED", timezone: "Asia/Dubai",
    center: [25.2048, 55.2708], iata: "DXB", airport: { name: "Dubai International Airport", lat: 25.2532, lon: 55.3657, local: "مطار دبي الدولي" },
    localCity: "دبي، الإمارات العربية المتحدة", localStreet: "شارع الشيخ زايد",
    emergency: { general: "999", police: "999", ambulance: "998", verified: true },
    region: "gulf", themes: ["family", "adventure", "honeymoon", "culture"], cost: 10000,
    pois: [p("Burj Khalifa", "برج خليفة", 25.1972, 55.2744), p("Dubai Mall", "دبي مول", 25.1985, 55.2796), p("Dubai Marina", "مرسى دبي", 25.08, 55.1403), p("Atlantis, The Palm", "أتلانتس النخلة", 25.1304, 55.1171), p("Al Fahidi Historical District", "حي الفهيدي التاريخي", 25.2637, 55.2972), p("Museum of the Future", "متحف المستقبل", 25.2193, 55.2819)],
  },
  {
    slug: "abu-dhabi", name: "Abu Dhabi", country: "United Arab Emirates", iso2: "AE", currency: "AED", timezone: "Asia/Dubai",
    center: [24.4539, 54.3773], iata: "AUH", airport: { name: "Zayed International Airport", lat: 24.433, lon: 54.6511, local: "مطار زايد الدولي" },
    localCity: "أبوظبي، الإمارات العربية المتحدة", localStreet: "شارع الكورنيش",
    emergency: { general: "999", police: "999", ambulance: "998", verified: true },
    region: "gulf", themes: ["culture", "family", "adventure"], cost: 9000,
    pois: [p("Sheikh Zayed Grand Mosque", "جامع الشيخ زايد الكبير", 24.4128, 54.475), p("Louvre Abu Dhabi", "متحف اللوفر أبوظبي", 24.5336, 54.3985), p("Emirates Palace", "قصر الإمارات", 24.4617, 54.317), p("Abu Dhabi Corniche", "كورنيش أبوظبي", 24.478, 54.348), p("Yas Island", "جزيرة ياس", 24.4838, 54.6076)],
  },
  {
    slug: "singapore", name: "Singapore", country: "Singapore", iso2: "SG", currency: "SGD", timezone: "Asia/Singapore",
    center: [1.3521, 103.8198], iata: "SIN", airport: { name: "Changi Airport", lat: 1.3644, lon: 103.9915, local: "樟宜机场" },
    localCity: "新加坡", localStreet: "乌节路",
    emergency: { general: "999", police: "999", ambulance: "995", verified: true },
    region: "sea", themes: ["family", "culture", "honeymoon", "adventure"], cost: 11000,
    pois: [p("Marina Bay Sands", "滨海湾金沙", 1.2834, 103.8607), p("Gardens by the Bay", "滨海湾花园", 1.2816, 103.8636), p("Sentosa Island", "圣淘沙", 1.2494, 103.8303), p("Merlion Park", "鱼尾狮公园", 1.2868, 103.8545), p("Chinatown", "牛车水", 1.2833, 103.8438), p("Singapore Zoo", "新加坡动物园", 1.4043, 103.793)],
  },
  {
    slug: "bali", name: "Bali", country: "Indonesia", iso2: "ID", currency: "IDR", timezone: "Asia/Makassar",
    center: [-8.65, 115.2167], iata: "DPS", airport: { name: "Ngurah Rai International Airport", lat: -8.7467, lon: 115.1668, local: "Bandara Internasional Ngurah Rai" },
    localCity: "Denpasar, Bali, Indonesia", localStreet: "Jalan Raya Seminyak",
    emergency: { general: "112", police: "110", ambulance: "118", verified: false },
    region: "sea", themes: ["beach", "honeymoon", "adventure", "culture"], cost: 6500,
    pois: [p("Uluwatu Temple", "Pura Luhur Uluwatu", -8.8291, 115.0849), p("Tanah Lot Temple", "Pura Tanah Lot", -8.6212, 115.0868), p("Sacred Monkey Forest, Ubud", "Monkey Forest Ubud", -8.5188, 115.2587), p("Seminyak Beach", "Pantai Seminyak", -8.6913, 115.1581), p("Tegallalang Rice Terrace", "Terasering Tegallalang", -8.4312, 115.2793), p("Kuta Beach", "Pantai Kuta", -8.7184, 115.1686)],
  },
  {
    slug: "bangkok", name: "Bangkok", country: "Thailand", iso2: "TH", currency: "THB", timezone: "Asia/Bangkok",
    center: [13.7563, 100.5018], iata: "BKK", airport: { name: "Suvarnabhumi Airport", lat: 13.69, lon: 100.7501, local: "ท่าอากาศยานสุวรรณภูมิ" },
    localCity: "กรุงเทพมหานคร ประเทศไทย", localStreet: "ถนนสุขุมวิท",
    emergency: { general: "191", police: "191", ambulance: "1669", verified: true },
    region: "sea", themes: ["culture", "family", "adventure"], cost: 5500,
    pois: [p("Grand Palace", "พระบรมมหาราชวัง", 13.75, 100.4913), p("Wat Arun", "วัดอรุณราชวราราม", 13.7437, 100.4888), p("Chatuchak Weekend Market", "ตลาดนัดจตุจักร", 13.7998, 100.5504), p("Siam Paragon", "สยามพารากอน", 13.7461, 100.5347), p("Yaowarat (Chinatown)", "เยาวราช", 13.74, 100.51), p("Lumphini Park", "สวนลุมพินี", 13.7314, 100.5418)],
  },
  {
    slug: "phuket", name: "Phuket", country: "Thailand", iso2: "TH", currency: "THB", timezone: "Asia/Bangkok",
    center: [7.8804, 98.3923], iata: "HKT", airport: { name: "Phuket International Airport", lat: 8.1132, lon: 98.3169, local: "ท่าอากาศยานภูเก็ต" },
    localCity: "ภูเก็ต ประเทศไทย", localStreet: "ถนนราษฎร์อุทิศ",
    emergency: { general: "191", police: "191", ambulance: "1669", verified: true },
    region: "sea", themes: ["beach", "honeymoon", "family", "adventure"], cost: 6500,
    pois: [p("Patong Beach", "หาดป่าตอง", 7.8965, 98.2966), p("Big Buddha Phuket", "พระพุทธมิ่งมงคลเอกนวคีรี", 7.8276, 98.3125), p("Phuket Old Town", "เมืองเก่าภูเก็ต", 7.884, 98.388), p("Promthep Cape", "แหลมพรหมเทพ", 7.7619, 98.3052), p("Karon Beach", "หาดกะรน", 7.845, 98.294), p("Wat Chalong", "วัดฉลอง", 7.8461, 98.3374)],
  },
  {
    slug: "kuala-lumpur", name: "Kuala Lumpur", country: "Malaysia", iso2: "MY", currency: "MYR", timezone: "Asia/Kuala_Lumpur",
    center: [3.139, 101.6869], iata: "KUL", airport: { name: "Kuala Lumpur International Airport", lat: 2.7456, lon: 101.7072, local: "Lapangan Terbang Antarabangsa Kuala Lumpur" },
    localCity: "Kuala Lumpur, Malaysia", localStreet: "Jalan Bukit Bintang",
    emergency: { general: "999", police: "999", ambulance: "999", verified: true },
    region: "sea", themes: ["family", "culture", "adventure"], cost: 5500,
    pois: [p("Petronas Twin Towers", "Menara Berkembar Petronas", 3.1579, 101.7116), p("Batu Caves", "Gua Batu", 3.2379, 101.684), p("KL Tower", "Menara Kuala Lumpur", 3.1528, 101.7038), p("Merdeka Square", "Dataran Merdeka", 3.1487, 101.6935), p("Bukit Bintang", "Bukit Bintang", 3.1466, 101.7105), p("Central Market", "Pasar Seni", 3.1447, 101.6955)],
  },
  {
    slug: "hong-kong", name: "Hong Kong", country: "Hong Kong SAR", iso2: "HK", currency: "HKD", timezone: "Asia/Hong_Kong",
    center: [22.3193, 114.1694], iata: "HKG", airport: { name: "Hong Kong International Airport", lat: 22.308, lon: 113.9185, local: "香港國際機場" },
    localCity: "香港", localStreet: "彌敦道",
    emergency: { general: "999", police: "999", ambulance: "999", verified: true },
    region: "east-asia", themes: ["family", "culture", "adventure"], cost: 10000,
    pois: [p("Victoria Peak", "太平山頂", 22.2759, 114.1455), p("Tsim Sha Tsui Promenade", "尖沙咀海濱長廊", 22.2933, 114.174), p("Tian Tan Buddha", "天壇大佛", 22.254, 113.9047), p("Temple Street Night Market", "廟街夜市", 22.31, 114.17), p("Star Ferry, Central", "天星小輪 中環", 22.287, 114.161)],
  },
  {
    slug: "tokyo", name: "Tokyo", country: "Japan", iso2: "JP", currency: "JPY", timezone: "Asia/Tokyo",
    center: [35.6762, 139.6503], iata: "HND", airport: { name: "Haneda Airport", lat: 35.5494, lon: 139.7798, local: "羽田空港" },
    localCity: "東京都", localStreet: "新宿区西新宿",
    emergency: { general: "110", police: "110", ambulance: "119", verified: true },
    region: "east-asia", themes: ["culture", "family", "adventure", "honeymoon"], cost: 11000,
    pois: [p("Senso-ji Temple", "浅草寺", 35.7148, 139.7967), p("Shibuya Crossing", "渋谷スクランブル交差点", 35.6595, 139.7005), p("Tokyo Skytree", "東京スカイツリー", 35.7101, 139.8107), p("Meiji Jingu", "明治神宮", 35.6764, 139.6993), p("Tsukiji Outer Market", "築地場外市場", 35.6655, 139.7707), p("Tokyo Tower", "東京タワー", 35.6586, 139.7454)],
  },
  {
    slug: "seoul", name: "Seoul", country: "South Korea", iso2: "KR", currency: "KRW", timezone: "Asia/Seoul",
    center: [37.5665, 126.978], iata: "ICN", airport: { name: "Incheon International Airport", lat: 37.4602, lon: 126.4407, local: "인천국제공항" },
    localCity: "서울특별시", localStreet: "중구 명동길",
    emergency: { general: "112", police: "112", ambulance: "119", verified: true },
    region: "east-asia", themes: ["culture", "family", "honeymoon"], cost: 9000,
    pois: [p("Gyeongbokgung Palace", "경복궁", 37.5796, 126.977), p("N Seoul Tower", "N서울타워", 37.5512, 126.9882), p("Myeongdong", "명동", 37.5636, 126.9822), p("Bukchon Hanok Village", "북촌한옥마을", 37.5826, 126.983), p("Hongdae", "홍대", 37.5563, 126.9236), p("Dongdaemun", "동대문", 37.5712, 127.0095)],
  },
  {
    slug: "hanoi", name: "Hanoi", country: "Vietnam", iso2: "VN", currency: "VND", timezone: "Asia/Ho_Chi_Minh",
    center: [21.0285, 105.8542], iata: "HAN", airport: { name: "Noi Bai International Airport", lat: 21.2212, lon: 105.8072, local: "Sân bay quốc tế Nội Bài" },
    localCity: "Hà Nội, Việt Nam", localStreet: "Phố Hàng Bông",
    emergency: { general: "113", police: "113", ambulance: "115", verified: true },
    region: "sea", themes: ["culture", "adventure", "family"], cost: 4800,
    pois: [p("Hoan Kiem Lake", "Hồ Hoàn Kiếm", 21.0288, 105.8522), p("Old Quarter", "Phố cổ Hà Nội", 21.034, 105.85), p("Temple of Literature", "Văn Miếu", 21.0275, 105.8355), p("Ho Chi Minh Mausoleum", "Lăng Chủ tịch Hồ Chí Minh", 21.0368, 105.8346), p("Train Street", "Phố đường tàu", 21.0245, 105.8445), p("West Lake", "Hồ Tây", 21.0583, 105.8231)],
  },
  {
    slug: "ho-chi-minh-city", name: "Ho Chi Minh City", country: "Vietnam", iso2: "VN", currency: "VND", timezone: "Asia/Ho_Chi_Minh",
    center: [10.7769, 106.7009], iata: "SGN", airport: { name: "Tan Son Nhat International Airport", lat: 10.8188, lon: 106.652, local: "Sân bay quốc tế Tân Sơn Nhất" },
    localCity: "Thành phố Hồ Chí Minh, Việt Nam", localStreet: "Đường Nguyễn Huệ",
    emergency: { general: "113", police: "113", ambulance: "115", verified: true },
    region: "sea", themes: ["culture", "adventure", "family"], cost: 4800,
    pois: [p("Ben Thanh Market", "Chợ Bến Thành", 10.7725, 106.698), p("War Remnants Museum", "Bảo tàng Chứng tích Chiến tranh", 10.7794, 106.6922), p("Notre-Dame Cathedral Basilica", "Nhà thờ Đức Bà Sài Gòn", 10.7798, 106.699), p("Independence Palace", "Dinh Độc Lập", 10.777, 106.6955), p("Bui Vien Walking Street", "Phố đi bộ Bùi Viện", 10.7672, 106.6937), p("Saigon Skydeck", "Saigon Skydeck", 10.7716, 106.7043)],
  },
  {
    slug: "maldives", name: "Maldives (Malé)", country: "Maldives", iso2: "MV", currency: "MVR", timezone: "Indian/Maldives",
    center: [4.1755, 73.5093], iata: "MLE", airport: { name: "Velana International Airport", lat: 4.1918, lon: 73.529, local: "ވެލާނާ ބައިނަލްއަގްވާމީ ވައިގެ ބަނދަރު" },
    localCity: "މާލެ، ދިވެހިރާއްޖެ", localStreet: "ބޯޑުތަކުރުފާނު މަގު",
    emergency: { general: "119", police: "119", ambulance: "102", verified: false },
    region: "south-asia", themes: ["beach", "honeymoon", "family"], cost: 14000,
    pois: [p("Hulhumalé Beach", "ހުޅުމާލެ ބީޗް", 4.2105, 73.54), p("Grand Friday Mosque", "ޖުމްޢާ މިސްކިތް", 4.1757, 73.5106), p("Malé Fish Market", "މާލެ މަސްމާރުކޭޓް", 4.179, 73.516), p("Sultan Park", "ސުލްޠާން ޕާކް", 4.1743, 73.5107), p("Artificial Beach, Malé", "އާޓިފިޝަލް ބީޗް", 4.17, 73.523)],
  },
  {
    slug: "colombo", name: "Colombo", country: "Sri Lanka", iso2: "LK", currency: "LKR", timezone: "Asia/Colombo",
    center: [6.9271, 79.8612], iata: "CMB", airport: { name: "Bandaranaike International Airport", lat: 7.1808, lon: 79.8841, local: "බණ්ඩාරනායක ජාත්‍යන්තර ගුවන්තොටුපළ" },
    localCity: "කොළඹ, ශ්‍රී ලංකාව", localStreet: "ගාලු පාර",
    emergency: { general: "119", police: "119", ambulance: "1990", verified: true },
    region: "south-asia", themes: ["beach", "culture", "family"], cost: 5000,
    pois: [p("Galle Face Green", "ගාලු මුවදොර හරිතය", 6.9271, 79.845), p("Gangaramaya Temple", "ගංගාරාම විහාරය", 6.9167, 79.8561), p("Pettah Market", "පිට කොටුව", 6.937, 79.85), p("Colombo National Museum", "කොළඹ ජාතික කෞතුකාගාරය", 6.9097, 79.861), p("Colombo Lotus Tower", "කොළඹ නෙළුම් කුළුණ", 6.9272, 79.8585)],
  },
  {
    slug: "istanbul", name: "Istanbul", country: "Türkiye", iso2: "TR", currency: "TRY", timezone: "Europe/Istanbul",
    center: [41.0082, 28.9784], iata: "IST", airport: { name: "Istanbul Airport", lat: 41.2753, lon: 28.7519, local: "İstanbul Havalimanı" },
    localCity: "İstanbul, Türkiye", localStreet: "İstiklal Caddesi",
    emergency: { general: "112", police: "155", ambulance: "112", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 7500,
    pois: [p("Hagia Sophia", "Ayasofya-i Kebir Cami-i Şerifi", 41.0086, 28.9802), p("Blue Mosque", "Sultanahmet Camii", 41.0054, 28.9768), p("Topkapi Palace", "Topkapı Sarayı", 41.0115, 28.9834), p("Grand Bazaar", "Kapalıçarşı", 41.0107, 28.968), p("Galata Tower", "Galata Kulesi", 41.0256, 28.9744), p("Eminönü Ferry Pier", "Eminönü İskelesi", 41.0176, 28.9706)],
  },
  {
    slug: "athens", name: "Athens", country: "Greece", iso2: "GR", currency: "EUR", timezone: "Europe/Athens",
    center: [37.9838, 23.7275], iata: "ATH", airport: { name: "Athens Eleftherios Venizelos Airport", lat: 37.9364, lon: 23.9445, local: "Διεθνής Αερολιμένας Αθηνών" },
    localCity: "Αθήνα, Ελλάδα", localStreet: "Οδός Ερμού",
    emergency: { general: "112", police: "100", ambulance: "166", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 8500,
    pois: [p("Acropolis of Athens", "Ακρόπολη Αθηνών", 37.9715, 23.7257), p("Plaka", "Πλάκα", 37.9725, 23.73), p("Ancient Agora", "Αρχαία Αγορά", 37.976, 23.722), p("Syntagma Square", "Πλατεία Συντάγματος", 37.9755, 23.7348), p("Monastiraki", "Μοναστηράκι", 37.976, 23.7255), p("Panathenaic Stadium", "Παναθηναϊκό Στάδιο", 37.9684, 23.7411)],
  },
  {
    slug: "rome", name: "Rome", country: "Italy", iso2: "IT", currency: "EUR", timezone: "Europe/Rome",
    center: [41.9028, 12.4964], iata: "FCO", airport: { name: "Rome Fiumicino Airport (FCO)", lat: 41.8003, lon: 12.2389, local: "Aeroporto di Roma-Fiumicino" },
    localCity: "Roma, Italia", localStreet: "Via Giovanni Giolitti",
    emergency: { general: "112", police: "113", ambulance: "118", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 12000,
    pois: [p("Colosseum", "Colosseo", 41.8902, 12.4922), p("Vatican Museums", "Musei Vaticani", 41.9065, 12.4536), p("Trevi Fountain", "Fontana di Trevi", 41.9009, 12.4833), p("Pantheon", "Pantheon", 41.8986, 12.4769), p("Roman Forum", "Foro Romano", 41.8925, 12.4853), p("Piazza Navona", "Piazza Navona", 41.8992, 12.4731), p("Roma Termini", "Stazione Roma Termini", 41.9009, 12.5016)],
  },
  {
    slug: "paris", name: "Paris", country: "France", iso2: "FR", currency: "EUR", timezone: "Europe/Paris",
    center: [48.8566, 2.3522], iata: "CDG", airport: { name: "Paris Charles de Gaulle Airport (CDG)", lat: 49.0097, lon: 2.5479, local: "Aéroport de Paris-Charles de Gaulle" },
    localCity: "Paris, France", localStreet: "Rue de Rivoli",
    emergency: { general: "112", police: "17", ambulance: "15", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 13000,
    pois: [p("Eiffel Tower", "Tour Eiffel", 48.8584, 2.2945), p("Louvre Museum", "Musée du Louvre", 48.8606, 2.3376), p("Notre-Dame de Paris", "Cathédrale Notre-Dame de Paris", 48.853, 2.3499), p("Sacré-Cœur, Montmartre", "Basilique du Sacré-Cœur", 48.8867, 2.3431), p("Arc de Triomphe", "Arc de Triomphe", 48.8738, 2.295), p("Seine River Cruise (Port de la Bourdonnais)", "Croisière sur la Seine", 48.8611, 2.2937), p("Gare du Nord", "Gare du Nord", 48.8809, 2.3553)],
  },
  {
    slug: "zurich", name: "Zurich", country: "Switzerland", iso2: "CH", currency: "CHF", timezone: "Europe/Zurich",
    center: [47.3769, 8.5417], iata: "ZRH", airport: { name: "Zurich Airport", lat: 47.4647, lon: 8.5492, local: "Flughafen Zürich" },
    localCity: "Zürich, Schweiz", localStreet: "Bahnhofstrasse",
    emergency: { general: "112", police: "117", ambulance: "144", verified: true },
    region: "europe", themes: ["adventure", "honeymoon", "family", "culture"], cost: 16000,
    pois: [p("Zurich Old Town", "Altstadt Zürich", 47.3717, 8.5423), p("Lake Zurich Promenade", "Seepromenade Zürich", 47.3606, 8.5403), p("Bahnhofstrasse", "Bahnhofstrasse", 47.3769, 8.5393), p("Lindenhof", "Lindenhof", 47.3731, 8.5411), p("Uetliberg", "Üetliberg", 47.3498, 8.4916), p("Zürich Hauptbahnhof", "Zürich Hauptbahnhof", 47.3779, 8.5403)],
  },
  {
    slug: "prague", name: "Prague", country: "Czechia", iso2: "CZ", currency: "CZK", timezone: "Europe/Prague",
    center: [50.0755, 14.4378], iata: "PRG", airport: { name: "Václav Havel Airport Prague", lat: 50.1008, lon: 14.26, local: "Letiště Václava Havla Praha" },
    localCity: "Praha, Česko", localStreet: "Václavské náměstí",
    emergency: { general: "112", police: "158", ambulance: "155", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 8000,
    pois: [p("Charles Bridge", "Karlův most", 50.0865, 14.4114), p("Prague Castle", "Pražský hrad", 50.0909, 14.4), p("Old Town Square", "Staroměstské náměstí", 50.0875, 14.4213), p("Astronomical Clock", "Pražský orloj", 50.087, 14.4207), p("Wenceslas Square", "Václavské náměstí", 50.0813, 14.428), p("Petřín Lookout Tower", "Petřínská rozhledna", 50.0833, 14.3953)],
  },
  {
    slug: "amsterdam", name: "Amsterdam", country: "Netherlands", iso2: "NL", currency: "EUR", timezone: "Europe/Amsterdam",
    center: [52.3676, 4.9041], iata: "AMS", airport: { name: "Amsterdam Airport Schiphol", lat: 52.3105, lon: 4.7683, local: "Luchthaven Schiphol" },
    localCity: "Amsterdam, Nederland", localStreet: "Damrak",
    emergency: { general: "112", police: "112", ambulance: "112", verified: true },
    region: "europe", themes: ["culture", "family", "honeymoon"], cost: 13000,
    pois: [p("Rijksmuseum", "Rijksmuseum", 52.36, 4.8852), p("Anne Frank House", "Anne Frank Huis", 52.3752, 4.884), p("Van Gogh Museum", "Van Gogh Museum", 52.3584, 4.8811), p("Vondelpark", "Vondelpark", 52.3579, 4.8686), p("Amsterdam Centraal", "Amsterdam Centraal", 52.3791, 4.9003), p("Dam Square", "De Dam", 52.3731, 4.8932)],
  },
  {
    slug: "barcelona", name: "Barcelona", country: "Spain", iso2: "ES", currency: "EUR", timezone: "Europe/Madrid",
    center: [41.3874, 2.1686], iata: "BCN", airport: { name: "Barcelona–El Prat Airport", lat: 41.2974, lon: 2.0833, local: "Aeroport de Barcelona-El Prat" },
    localCity: "Barcelona, España", localStreet: "Passeig de Gràcia",
    emergency: { general: "112", police: "112", ambulance: "112", verified: true },
    region: "europe", themes: ["culture", "beach", "family", "honeymoon"], cost: 11000,
    pois: [p("Sagrada Família", "Basílica de la Sagrada Família", 41.4036, 2.1744), p("Park Güell", "Parc Güell", 41.4145, 2.1527), p("La Rambla", "La Rambla", 41.3797, 2.1746), p("Gothic Quarter", "Barri Gòtic", 41.3833, 2.1767), p("Casa Batlló", "Casa Batlló", 41.3917, 2.1649), p("Barceloneta Beach", "Platja de la Barceloneta", 41.3784, 2.1925)],
  },
  {
    slug: "vienna", name: "Vienna", country: "Austria", iso2: "AT", currency: "EUR", timezone: "Europe/Vienna",
    center: [48.2082, 16.3738], iata: "VIE", airport: { name: "Vienna International Airport", lat: 48.1103, lon: 16.5697, local: "Flughafen Wien-Schwechat" },
    localCity: "Wien, Österreich", localStreet: "Kärntner Straße",
    emergency: { general: "112", police: "133", ambulance: "144", verified: true },
    region: "europe", themes: ["culture", "honeymoon", "family"], cost: 11000,
    pois: [p("Schönbrunn Palace", "Schloss Schönbrunn", 48.1845, 16.3122), p("St. Stephen's Cathedral", "Stephansdom", 48.2084, 16.3731), p("Hofburg Palace", "Hofburg", 48.2065, 16.3663), p("Belvedere Palace", "Schloss Belvedere", 48.1915, 16.3808), p("Naschmarkt", "Naschmarkt", 48.1987, 16.3634), p("Wiener Riesenrad", "Wiener Riesenrad", 48.2166, 16.3959)],
  },
  {
    slug: "london", name: "London", country: "United Kingdom", iso2: "GB", currency: "GBP", timezone: "Europe/London",
    center: [51.5074, -0.1278], iata: "LHR", airport: { name: "London Heathrow Airport", lat: 51.47, lon: -0.4543, local: "London Heathrow Airport" },
    localCity: "London, United Kingdom", localStreet: "Oxford Street",
    emergency: { general: "999", police: "999", ambulance: "999", verified: true },
    region: "europe", themes: ["culture", "family", "honeymoon"], cost: 14000,
    pois: [p("Tower of London", "Tower of London", 51.5081, -0.0759), p("Tower Bridge", "Tower Bridge", 51.5055, -0.0754), p("British Museum", "British Museum", 51.5194, -0.127), p("Buckingham Palace", "Buckingham Palace", 51.5014, -0.1419), p("London Eye", "London Eye", 51.5033, -0.1195), p("Camden Market", "Camden Market", 51.5415, -0.1462), p("King's Cross St Pancras", "King's Cross St Pancras", 51.5308, -0.1238)],
  },
  {
    slug: "sydney", name: "Sydney", country: "Australia", iso2: "AU", currency: "AUD", timezone: "Australia/Sydney",
    center: [-33.8688, 151.2093], iata: "SYD", airport: { name: "Sydney Kingsford Smith Airport", lat: -33.9399, lon: 151.1753, local: "Sydney Airport" },
    localCity: "Sydney NSW, Australia", localStreet: "George Street",
    emergency: { general: "000", police: "000", ambulance: "000", verified: true },
    region: "oceania", themes: ["beach", "family", "adventure", "culture"], cost: 13000,
    pois: [p("Sydney Opera House", "Sydney Opera House", -33.8568, 151.2153), p("Sydney Harbour Bridge", "Sydney Harbour Bridge", -33.8523, 151.2108), p("Bondi Beach", "Bondi Beach", -33.8915, 151.2767), p("Taronga Zoo", "Taronga Zoo", -33.8433, 151.2411), p("The Rocks", "The Rocks", -33.8587, 151.209), p("Darling Harbour", "Darling Harbour", -33.8731, 151.1987)],
  },
  {
    slug: "bangalore", name: "Bangalore", country: "India", iso2: "IN", currency: "INR", timezone: "Asia/Kolkata",
    center: [12.9716, 77.5946], iata: "BLR", airport: { name: "Kempegowda International Airport (BLR)", lat: 13.1986, lon: 77.7066, local: "ಕೆಂಪೇಗೌಡ ಅಂತರರಾಷ್ಟ್ರೀಯ ವಿಮಾನ ನಿಲ್ದಾಣ" },
    localCity: "ಬೆಂಗಳೂರು, ಕರ್ನಾಟಕ, ಭಾರತ", localStreet: "ಎಂ.ಜಿ. ರಸ್ತೆ",
    emergency: { general: "112", police: "100", ambulance: "108", verified: true },
    region: "south-asia", themes: ["culture", "family", "adventure"], cost: 6500,
    // Domestic demo destination: the one place the user can physically stand in to show the offline map and GPS working.
    pois: [
      p("Lalbagh Botanical Garden", "ಲಾಲ್‌ಬಾಗ್ ಸಸ್ಯೋದ್ಯಾನ", 12.9507, 77.5848), p("Cubbon Park", "ಕಬ್ಬನ್ ಉದ್ಯಾನ", 12.9763, 77.5929), p("Vidhana Soudha", "ವಿಧಾನ ಸೌಧ", 12.9797, 77.5907),
      p("Bangalore Palace", "ಬೆಂಗಳೂರು ಅರಮನೆ", 12.9988, 77.5921), p("ISKCON Temple Bangalore", "ಇಸ್ಕಾನ್ ದೇವಾಲಯ", 13.0098, 77.5511), p("Commercial Street", "ಕಮರ್ಷಿಯಲ್ ಸ್ಟ್ರೀಟ್", 12.9823, 77.6081),
      p("Dodda Basavana Gudi (Bull Temple)", "ದೊಡ್ಡ ಬಸವನ ಗುಡಿ", 12.9419, 77.5679), p("Tipu Sultan's Summer Palace", "ಟಿಪ್ಪು ಸುಲ್ತಾನ್ ಬೇಸಿಗೆ ಅರಮನೆ", 12.9593, 77.5738), p("UB City", "ಯು.ಬಿ. ಸಿಟಿ", 12.9718, 77.5961),
      // Bannerghatta side (south Bengaluru): the demo traveller stays here
      p("Bannerghatta Biological Park", "ಬನ್ನೇರುಘಟ್ಟ ಜೈವಿಕ ಉದ್ಯಾನವನ", 12.8006, 77.5766), p("Meenakshi Mall, Bannerghatta Road", "ಮೀನಾಕ್ಷಿ ಮಾಲ್", 12.8913, 77.5968),
    ],
    // fictional sample hotels placed on Bannerghatta Road (Arekere / Meenakshi Mall / Gottigere); the 4-star one is the standard demo trip's stay
    hotelAnchors: [{ lat: 12.8878, lon: 77.6012 }, { lat: 12.8925, lon: 77.5979 }, { lat: 12.8575, lon: 77.5934 }],
  },
];

/** Multi-city combos (count towards the 100+ itineraries). */
export const COMBOS: { cities: string[]; theme: Theme; tier: "budget" | "standard" | "premium"; nights: number; origin: string; slugOverride?: string }[] = [
  { cities: ["paris", "rome"], theme: "culture", tier: "standard", nights: 7, origin: "PNQ", slugOverride: "paris-rome-classic-7n" },
  { cities: ["zurich", "paris"], theme: "honeymoon", tier: "premium", nights: 8, origin: "BOM" },
  { cities: ["rome", "barcelona"], theme: "culture", tier: "standard", nights: 7, origin: "DEL" },
  { cities: ["prague", "vienna"], theme: "culture", tier: "budget", nights: 6, origin: "HYD" },
  { cities: ["amsterdam", "paris"], theme: "family", tier: "standard", nights: 7, origin: "BLR" },
  { cities: ["london", "paris"], theme: "culture", tier: "premium", nights: 8, origin: "DEL" },
  { cities: ["athens", "istanbul"], theme: "honeymoon", tier: "standard", nights: 7, origin: "AMD" },
  { cities: ["bangkok", "phuket"], theme: "beach", tier: "budget", nights: 6, origin: "CCU" },
  { cities: ["singapore", "kuala-lumpur"], theme: "family", tier: "standard", nights: 6, origin: "MAA" },
  { cities: ["hanoi", "ho-chi-minh-city"], theme: "adventure", tier: "budget", nights: 7, origin: "BOM" },
  { cities: ["dubai", "abu-dhabi"], theme: "family", tier: "standard", nights: 5, origin: "DEL" },
  // Domestic demo trips to Bangalore (3 nights; origin is never BLR itself)
  { cities: ["bangalore"], theme: "culture", tier: "standard", nights: 3, origin: "DEL", slugOverride: "bangalore-3n-standard-culture" },
  { cities: ["bangalore"], theme: "family", tier: "budget", nights: 3, origin: "BOM", slugOverride: "bangalore-3n-budget-family" },
];

export const CARRIERS = [
  { code: "SS", name: "SS Air" },
  { code: "MR", name: "Meridian Airways" },
  { code: "KS", name: "Kesari Air" },
  { code: "AJ", name: "Aurora Jet" },
  { code: "TW", name: "Tarang Wings" },
];

export const THEME_TITLES: Record<Theme, string[]> = {
  beach: ["Sun, Sand & Slow Mornings", "Beach Escape", "Island Time"],
  culture: ["Culture & Cuisine", "Heritage Highlights", "Old Streets, New Stories"],
  adventure: ["Adventure Trail", "Off the Beaten Path", "Thrill Seeker"],
  family: ["Family Fun Getaway", "Holiday for All Ages", "Kids Love It"],
  honeymoon: ["Romantic Retreat", "Honeymoon Special", "Just the Two of Us"],
};

export const HERO_PALETTES: Record<Region, [string, string][]> = {
  gulf: [["#F59E0B", "#7C2D12"], ["#FDE68A", "#92400E"]],
  sea: [["#10B981", "#064E3B"], ["#22D3EE", "#0C4A6E"]],
  "east-asia": [["#F472B6", "#4C1D95"], ["#FB7185", "#7F1D1D"]],
  "south-asia": [["#38BDF8", "#1E3A8A"], ["#2DD4BF", "#134E4A"]],
  europe: [["#818CF8", "#1E1B4B"], ["#A78BFA", "#312E81"]],
  oceania: [["#34D399", "#1E3A8A"], ["#60A5FA", "#0F172A"]],
};
