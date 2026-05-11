// api/generate-pfp.js — South Pump PFP Lab Backend
// Vercel Serverless Function — maxDuration: 60 (set in vercel.json)
//
// Required env var: OPENROUTER_API_KEY
//
// Pipeline:
//   Step 1 — GPT-4o vision    → describes the person
//   Step 2 — FLUX 1.1 Pro     → generates South Park portrait
//   Both via OpenRouter's /v1/chat/completions (correct endpoint for image gen)

// ── In-memory rate limiter ───────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT   = 10;                 // requests per window per IP
const RATE_WINDOW  = 10 * 60 * 1000;    // 10 minutes

function checkRateLimit(ip) {
    const now   = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
        return { allowed: true };
    }
    if (entry.count >= RATE_LIMIT) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count++;
    return { allowed: true };
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {

    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    // Rate limit
    const ip    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
        return res.status(429).json({
            error:      `Rate limit reached. Try again in ${limit.retryAfter} seconds.`,
            retryAfter: limit.retryAfter
        });
    }

    const { imageBase64, extraPrompt = '' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    if (imageBase64.length > 7_000_000) return res.status(400).json({ error: 'Image too large (max ~4MB).' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in Vercel environment variables.' });

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://southpump.fun',
        'X-Title':       'South Pump PFP Lab'
    };

    try {

        // ── Step 1: Describe person with GPT-4o Vision ───────────────────────
        const visionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method:  'POST',
            headers,
            body: JSON.stringify({
                model: 'openai/gpt-4o',
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type:      'image_url',
                            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' }
                        },
                        {
                            type: 'text',
                            text: 'Describe this person\'s physical appearance so an artist can draw them as a South Park cartoon. Include: hair color and style, face shape, skin tone, body type, notable facial features, and exact clothing + accessories. Max 80 words. No real names.'
                        }
                    ]
                }],
                max_tokens: 160
            })
        });

        const visionData = await visionRes.json();
        if (!visionRes.ok) {
            console.error('[Vision error]', visionRes.status, JSON.stringify(visionData));
            throw new Error(visionData.error?.message || `Vision step failed (${visionRes.status})`);
        }

        const description = visionData.choices?.[0]?.message?.content?.trim();
        if (!description) throw new Error('Could not read the image. Try a clearer, front-facing photo.');

        // ── Step 2: Generate South Park portrait with FLUX 1.1 Pro ──────────
        // OpenRouter image gen uses /v1/chat/completions + modalities:["image"]
        const safeExtra = (extraPrompt || '').slice(0, 200);
        const prompt    = [
            'South Park cartoon character portrait.',
            'Flat 2D construction paper cutout art style.',
            'Thick black outlines, vibrant primary colors, simple shapes, white background.',
            `Character: ${description}`,
            safeExtra || '',
            'Centered square portrait. Authentic South Park animation aesthetic. No text.'
        ].filter(Boolean).join(' ');

        const genRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method:  'POST',
            headers,
            body: JSON.stringify({
                model:      'black-forest-labs/flux-1.1-pro',
                modalities: ['image'],
                messages:   [{ role: 'user', content: prompt }]
            })
        });

        const genData = await genRes.json();
        if (!genRes.ok) {
            console.error('[Generation error]', genRes.status, JSON.stringify(genData));
            throw new Error(genData.error?.message || `Image generation failed (${genRes.status})`);
        }

        // OpenRouter returns images in choices[0].message.images[] as data URLs
        const imageDataUrl = genData.choices?.[0]?.message?.images?.[0]
                          || genData.choices?.[0]?.message?.content;

        if (!imageDataUrl) {
            console.error('[No image] Full response:', JSON.stringify(genData));
            throw new Error('No image returned. Full response logged.');
        }

        return res.status(200).json({ url: imageDataUrl, description });

    } catch (err) {
        console.error('[PFP Lab]', err.message);
        return res.status(500).json({ error: err.message });
    }
};
