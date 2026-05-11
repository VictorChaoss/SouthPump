// api/generate-pfp.js
// South Pump PFP Lab — Vercel Serverless Function
// maxDuration: 60 set in vercel.json
// Requires: OPENROUTER_API_KEY in Vercel environment variables

const RATE_LIMIT  = 10;
const RATE_WINDOW = 10 * 60 * 1000; // 10 min
const rateMap     = new Map();

function checkRate(ip) {
    const now = Date.now();
    const rec = rateMap.get(ip);
    if (!rec || now > rec.reset) { rateMap.set(ip, { count: 1, reset: now + RATE_WINDOW }); return true; }
    if (rec.count >= RATE_LIMIT) return false;
    rec.count++;
    return true;
}

module.exports = async function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (!checkRate(ip)) return res.status(429).json({ error: 'Rate limit reached. Try again in a few minutes.' });

    const { imageBase64, extraPrompt = '' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    if (imageBase64.length > 7_000_000) return res.status(400).json({ error: 'Image too large. Use a photo under 4MB.' });

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in Vercel environment variables.' });

    const H = {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://southpump.fun',
        'X-Title':       'South Pump PFP Lab'
    };

    try {
        // ── STEP 1: Describe the person (GPT-4o vision via OpenRouter) ────────
        const v = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', headers: H,
            body: JSON.stringify({
                model: 'openai/gpt-4o',
                max_tokens: 200,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
                        { type: 'text', text: 'Describe this person for a South Park cartoon artist. Include: hair colour/style, face shape, skin tone, build, notable features, clothing and accessories. Max 80 words. No names.' }
                    ]
                }]
            })
        });

        const vj = await v.json();
        if (!v.ok) {
            console.error('[Vision Error]', JSON.stringify(vj));
            throw new Error(`[VISION_API_ERROR] ${v.status} - ${JSON.stringify(vj)}`);
        }
        const description = vj.choices?.[0]?.message?.content?.trim();
        if (!description) throw new Error('Could not read the image. Try a clearer front-facing photo.');

        // ── STEP 2: Generate South Park portrait (FLUX via OpenRouter) ────────
        // Per OpenRouter docs: /v1/chat/completions + modalities:["image"]
        // Response: choices[0].message.images[0].image_url.url
        const extra  = (extraPrompt || '').slice(0, 200);
        const prompt = [
            'South Park cartoon character portrait.',
            'Flat 2D construction paper cutout art style.',
            'Thick black outlines, bold primary colours, simple shapes.',
            `Character: ${description}`,
            extra || '',
            'White background. Centred square portrait. No text or watermarks.'
        ].filter(Boolean).join(' ');

        const g = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', headers: H,
            body: JSON.stringify({
                model:      'google/gemini-3.1-flash-image-preview',
                modalities: ['image', 'text'],
                messages:   [{ role: 'user', content: prompt }]
            })
        });

        const gj = await g.json();
        if (!g.ok) {
            console.error('[Generation Error]', JSON.stringify(gj));
            throw new Error(`[GEN_API_ERROR] ${g.status} - ${JSON.stringify(gj)}`);
        }

        // Exact path per OpenRouter docs: choices[0].message.images[0].image_url.url
        // Also fallback to other common paths just in case
        const message = gj.choices?.[0]?.message;
        const url = message?.images?.[0]?.image_url?.url || message?.images?.[0]?.url || message?.content;
        
        if (!url || !url.startsWith('data:')) {
            console.error('[PFP] Unexpected generation response:', JSON.stringify(gj));
            throw new Error('No image returned. The model may be temporarily unavailable — please try again.');
        }

        return res.status(200).json({ url, description });

    } catch (err) {
        console.error('[PFP Lab]', err.message);
        return res.status(500).json({ error: err.message });
    }
};
