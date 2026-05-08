import https from 'https';

const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

const prompt = `Search for the latest hantavirus outbreak data worldwide today. Include MV Hondius cruise ship outbreak, Argentina season, any new confirmed cases in any country. Return ONLY a valid JSON array. Each item must have exactly: country, region (america/europe/asia/africa), lat, lng, cases, deaths, lethality (0-100 number), year, year_label, status (active or historic), strain, p2p (boolean), note (max 200 chars), highlight (boolean). No markdown, no explanation, just the JSON array.`;

async function callClaude() {
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

async function main() {
  console.log('Calling Claude API...');
  const response = await callClaude();

  console.log('Response type:', response.type);
  if (response.error) throw new Error(`Claude error: ${response.error.message}`);

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1) throw new Error('No JSON array in response');

  const outbreaks = JSON.parse(text.substring(start, end + 1));
  console.log(`Parsed ${outbreaks.length} outbreaks`);

  // Delete existing
  const delRes = await fetch(`${SUPA_URL}/rest/v1/hantavirus_outbreaks?id=gt.0`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`
    }
  });
  console.log('Delete status:', delRes.status);

  // Insert new
  const insRes = await fetch(`${SUPA_URL}/rest/v1/hantavirus_outbreaks`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(outbreaks.map(o => ({
      country: o.country,
      region: o.region || 'america',
      lat: Number(o.lat) || 0,
      lng: Number(o.lng) || 0,
      cases: Number(o.cases) || 0,
      deaths: Number(o.deaths) || 0,
      lethality: Number(o.lethality) || 0,
      year: Number(o.year) || 2026,
      year_label: o.year_label || String(o.year),
      status: o.status || 'historic',
      strain: o.strain || 'Andes',
      p2p: Boolean(o.p2p),
      note: (o.note || '').substring(0, 500),
      highlight: Boolean(o.highlight),
      updated_at: new Date().toISOString()
    })))
  });

  console.log('Insert status:', insRes.status);
  if (!insRes.ok) {
    const err = await insRes.text();
    throw new Error(`Insert failed: ${err}`);
  }

  console.log('Done!');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
