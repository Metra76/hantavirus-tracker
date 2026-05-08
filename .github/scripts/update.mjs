onst CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

// ═══ CLAUDE API CALL ═══
async function callClaude(prompt) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body
  });
  return res.json();
}

function extractJSON(text, isArray = true) {
  const clean = text.replace(/```json|```/g, '').trim();
  const opener = isArray ? '[' : '{';
  const closer = isArray ? ']' : '}';
  // Try to find JSON array/object anywhere in the text
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === opener) {
      if (start === -1) start = i;
      depth++;
    } else if (clean[i] === closer) {
      depth--;
      if (depth === 0 && start !== -1) { end = i; break; }
    }
  }
  if (start === -1 || end === -1) {
    console.error('Raw response:', text.substring(0, 500));
    throw new Error('No JSON found');
  }
  return JSON.parse(clean.substring(start, end + 1));
}

// ═══ UPDATE OUTBREAK DATA ═══
async function updateOutbreaks() {
  console.log('Fetching outbreak data...');
  const prompt = `Search the web for current hantavirus outbreak data. Search for: "hantavirus cases 2026", "MV Hondius hantavirus", "hantavirus Argentina 2026", "hantavirus Germany 2026", "hantavirus China HFRS".

After searching, you MUST output a JSON array using whatever real data you found. Use your training knowledge to fill in well-documented historical data (Argentina annual cases, Germany Puumala cases, China HFRS, etc.) and supplement with search results for 2026 active outbreaks.

The JSON array must follow this exact format with no exceptions:
[{"country":"Argentina","region":"america","lat":-38.5,"lng":-65.0,"cases":101,"deaths":32,"lethality":31.7,"year":2026,"year_label":"2025-2026","status":"active","strain":"Andes","p2p":true,"note":"Record season 2025-26. 101 cases, 32 deaths.","highlight":false},...]

Output ONLY the JSON array starting with [ and ending with ]. No explanations, no apologies, no other text whatsoever. Start your response with [ immediately.`;

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
  const prompt = `Search the web for the 8 most recent real news articles about hantavirus published today or this week. Focus on: MV Hondius cruise ship outbreak May 2026, new confirmed cases, WHO statements, Argentina season data, scientific developments.

For each article you find, extract: title, a 2-3 sentence summary of the article content, source name, publication date, and URL.

Return the results as a JSON array: [{title, summary, source, date, url}]

Return ONLY the JSON array, no other text.`;

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
  console.log('Waiting 15 seconds before news fetch...');
  await new Promise(r => setTimeout(r, 15000));
  const newsCount = await updateNews();
  console.log(`Done! ${outbreakCount} outbreaks + ${newsCount} news items updated.`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
