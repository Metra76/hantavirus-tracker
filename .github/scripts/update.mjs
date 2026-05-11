const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  return res.json();
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '[') { if (start === -1) start = i; depth++; }
    else if (clean[i] === ']') { depth--; if (depth === 0 && start !== -1) { end = i; break; } }
  }
  if (start === -1 || end === -1) { console.error('Raw:', text.substring(0, 300)); throw new Error('No JSON array found'); }
  return JSON.parse(clean.substring(start, end + 1));
}

async function supabaseDelete(table) {
  return fetch(`${SUPA_URL}/rest/v1/${table}?id=gt.0`, {
    method: 'DELETE',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
}

async function supabaseInsert(table, rows) {
  return fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
}

async function updateOutbreaks() {
  console.log('Fetching outbreak data...');
  const prompt = `Search the web for current hantavirus data. Then output ONLY a JSON array starting with [ — no other text before or after.

STATUS RULES — apply these strictly:
- "active" = laboratory-confirmed case or death, officially reported by health authorities
- "suspected" = unconfirmed, under investigation, or contact being monitored
- "historic" = past seasons, not currently active

COUNTRY NAMING RULES — use exactly these names:
- MV Hondius cruise ship = country "Atlantic / MV Hondius", lat 28.0, lng -16.5, region america
- All Spain contacts = country "Spain" (combine all into one entry)
- All France contacts = country "France"
- All Italy contacts = country "Italy"
- All Singapore contacts = country "Singapore"
- All USA contacts = country "USA — contacts"
- Netherlands cruise patients = country "Netherlands (cruise)"
- Germany cruise death = country "Germany (cruise)"
- Chile contacts = country "Chile — contacts"
- Canada contacts = country "Canada — contacts"

SUSPECTED CASES RULE: Always set cases >= 1 for suspected entries so they appear on the map.

MV Hondius 2026 status rules:
- South Africa: lab-confirmed death = "active"
- Switzerland: lab-confirmed = "active"
- Netherlands: confirmed evacuated patients = "active"
- Germany cruise: confirmed death = "active"
- Spain, France, Italy, Singapore, USA, UK, Canada contacts = "suspected"

Each item: {"country":"string","region":"america|europe|asia|africa","lat":0,"lng":0,"cases":0,"deaths":0,"lethality":0,"year":2026,"year_label":"string","status":"active|suspected|historic","strain":"Andes|Sin Nombre|Hantaan|Seoul|Puumala|Dobrava|Juquitiba|Araraquara|Choclo|Laguna Negra|Río Mamoré","p2p":false,"note":"string max 200 chars","highlight":false}

Include ALL: Argentina 2020-2026, Chile, Brazil, USA historic, Germany historic, Finland, Sweden, Russia, China, South Korea, Panama, Bolivia, Paraguay, MV Hondius 2026, Switzerland, South Africa, Netherlands cruise, Germany cruise, Spain, Italy, France, Singapore, USA contacts. Start response with [ immediately.`;

  const r = await callClaude(prompt);
  if (r.error) throw new Error(r.error.message);
  const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const outbreaks = extractJSON(text);
  console.log(`Got ${outbreaks.length} outbreaks`);

  await supabaseDelete('hantavirus_outbreaks');
  const res = await supabaseInsert('hantavirus_outbreaks', outbreaks.map(o => ({
    country: o.country, region: o.region || 'america',
    lat: Number(o.lat) || 0, lng: Number(o.lng) || 0,
    cases: Number(o.cases) || 0, deaths: Number(o.deaths) || 0,
    lethality: Number(o.lethality) || 0, year: Number(o.year) || 2026,
    year_label: o.year_label || String(o.year), status: o.status || 'historic',
    strain: o.strain || 'Andes', p2p: Boolean(o.p2p),
    note: (o.note || '').substring(0, 500), highlight: Boolean(o.highlight),
    updated_at: new Date().toISOString()
  })));
  console.log('Outbreaks status:', res.status);
}

async function updateNews() {
  console.log('Fetching news...');
  const prompt = `Search for 6 recent hantavirus news articles this week. Output ONLY a JSON array starting with [ — no other text. Each item: {"title":"string","summary":"2-3 sentences","source":"string","date":"YYYY-MM-DD","url":"string"}. Start with [ immediately.`;

  const r = await callClaude(prompt);
  if (r.error) throw new Error(r.error.message);
  const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const news = extractJSON(text);
  console.log(`Got ${news.length} news`);

  await supabaseDelete('hantavirus_news');
  const res = await supabaseInsert('hantavirus_news', news.map(n => ({
    title: (n.title || '').substring(0, 300),
    summary: (n.summary || '').substring(0, 1000),
    source: n.source || '', date: n.date || new Date().toISOString().substring(0, 10),
    url: n.url || '', lang: 'en', updated_at: new Date().toISOString()
  })));
  console.log('News status:', res.status);
}

async function main() {
  await updateOutbreaks();
  console.log('Done!');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
