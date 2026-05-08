const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

// ═══ CLAUDE API CALL ═══
async function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractJSON(text, isArray = true) {
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf(isArray ? '[' : '{');
  const end = clean.lastIndexOf(isArray ? ']' : '}');
  if (start === -1) throw new Error('No JSON found');
  return JSON.parse(clean.substring(start, end + 1));
}

// ═══ UPDATE OUTBREAK DATA ═══
async function updateOutbreaks() {
  console.log('Fetching outbreak data...');
  const prompt = `Search for the latest hantavirus outbreak data worldwide as of today. You MUST include ALL these countries: Argentina (multiple years 2020-2026), Chile, Brazil, USA, Germany, Finland, Sweden, Russia, China, South Korea, Panama, Bolivia, Paraguay, Slovenia, MV Hondius cruise 2026 (multi-country Andes P2P), Switzerland, South Africa, Netherlands, UK, Singapore, France, Canada. Include suspected cases with status=suspected. Return 25-35 records as a JSON array. Each record: {country, region (america/europe/asia/africa), lat, lng, cases, deaths, lethality (0-100), year, year_label, status (active/suspected/historic), strain, p2p (boolean), note (max 200 chars), highlight (boolean)}. ONLY the JSON array, no markdown.`;

  const response = await callClaude(prompt);
  if (response.error) throw new Error(`Claude error: ${response.error.message}`);

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const outbreaks = extractJSON(text);
  console.log(`Got ${outbreaks.length} outbreaks`);

  // Delete and reinsert
  await fetch(`${SUPA_URL}/rest/v1/hantavirus_outbreaks?id=gt.0`, {
    method: 'DELETE',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });

  const insRes = await fetch(`${SUPA_URL}/rest/v1/hantavirus_outbreaks`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(outbreaks.map(o => ({
      country: o.country, region: o.region || 'america',
      lat: Number(o.lat) || 0, lng: Number(o.lng) || 0,
      cases: Number(o.cases) || 0, deaths: Number(o.deaths) || 0,
      lethality: Number(o.lethality) || 0, year: Number(o.year) || 2026,
      year_label: o.year_label || String(o.year), status: o.status || 'historic',
      strain: o.strain || 'Andes', p2p: Boolean(o.p2p),
      note: (o.note || '').substring(0, 500), highlight: Boolean(o.highlight),
      updated_at: new Date().toISOString()
    })))
  });

  console.log('Outbreaks insert status:', insRes.status);
  return outbreaks.length;
}

// ═══ UPDATE NEWS ═══
async function updateNews() {
  console.log('Fetching latest news...');
  const prompt = `Search for the 8 most recent hantavirus news articles today. Focus on: MV Hondius cruise ship outbreak, new confirmed cases, WHO statements, Argentina season, scientific developments. Return ONLY a JSON array of 8 items: [{title, summary (2-3 sentences max), source, date, url}]. No markdown, just the JSON array.`;

  const response = await callClaude(prompt);
  if (response.error) throw new Error(`Claude news error: ${response.error.message}`);

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const news = extractJSON(text);
  console.log(`Got ${news.length} news items`);

  // Delete old news and insert new
  await fetch(`${SUPA_URL}/rest/v1/hantavirus_news?id=gt.0`, {
    method: 'DELETE',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });

  const insRes = await fetch(`${SUPA_URL}/rest/v1/hantavirus_news`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(news.map(n => ({
      title: (n.title || '').substring(0, 300),
      summary: (n.summary || '').substring(0, 1000),
      source: n.source || '',
      date: n.date || new Date().toISOString().substring(0, 10),
      url: n.url || '',
      lang: 'en',
      updated_at: new Date().toISOString()
    })))
  });

  console.log('News insert status:', insRes.status);
  return news.length;
}

// ═══ MAIN ═══
async function main() {
  const outbreakCount = await updateOutbreaks();
  const newsCount = await updateNews();
  console.log(`Done! ${outbreakCount} outbreaks + ${newsCount} news items updated.`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
