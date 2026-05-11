// api/generate-pfp.js — South Pump PFP Lab Backend
// Vercel Serverless Function — maxDuration: 60 (set in vercel.json)
//
// Required env var (Vercel Dashboard → Environment Variables):
//   OPENROUTER_API_KEY

// ── In-memory rate limiter ───────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT   = 5;
const RATE_WINDOW  = 10 * 60 * 1000; // 10 minutes

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
        return res.status(429).json({ error: `Rate limit. Try again in ${limit.retryAfter}s.`, retryAfter: limit.retryAfter });
    }

    const { imageBase64, extraPrompt = '' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    if (imageBase64.length > 7_000_000) return res.status(400).json({ error: 'Image too large (max 4MB).' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in Vercel environment variables.' });

    const orHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://southpump.fun',
        'X-Title':       'South Pump PFP Lab'
    };

    try {

        // ── Step 1: Vision — describe the person (GPT-4o via OpenRouter) ────
        const visionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method:  'POST',
            headers: orHeaders,
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
                            text: 'Describe this person\'s physical appearance for a South Park cartoon artist. Include hair color/style, face shape, skin tone, build, notable features, clothing and accessories. Max 80 words. No real names.'
                        }
                    ]
                }],
                max_tokens: 160
            })
        });

        const visionData = await visionRes.json();

        if (!visionRes.ok) {
            console.error('[Vision]', visionRes.status, JSON.stringify(visionData));
            const msg = visionData.error?.message || visionData.message || '';
            throw new Error(`Vision failed (${visionRes.status}): ${msg}`);
        }

        const description = visionData.choices?.[0]?.message?.content?.trim();
        if (!description) throw new Error('Could not read the image. Try a clearer front-facing photo.');

        // ── Step 2: Generate — DALL-E 3 via OpenRouter ──────────────────────
        const safeExtra = (extraPrompt || '').slice(0, 200);
        const prompt    = [
            'South Park cartoon style character portrait.',
            'Construction paper cutout art. Flat 2D, thick black outlines, vibrant colors, simple shapes.',
            `Character: ${description}`,
            safeExtra || '',
            'White background, centered portrait, no text.'
        ].filter(Boolean).join(' ');

        const genRes = await fetch('https://openrouter.ai/api/v1/images/generations', {
            method:  'POST',
            headers: orHeaders,
            body: JSON.stringify({
                model:  'openai/dall-e-3',
                prompt,
                n:      1,
                size:   '1024x1024'
            })
        });

        const genData = await genRes.json();

        // If OpenRouter doesn't support image generation for this key/plan,
        // return a clear error so we can action it
        if (!genRes.ok) {
            console.error('[Generation]', genRes.status, JSON.stringify(genData));
            const msg = genData.error?.message || genData.message || '';
            throw new Error(`Image generation failed (${genRes.status}): ${msg || 'OpenRouter may not support DALL-E 3 image generation on your plan.'}`);
        }

        const url = genData.data?.[0]?.url;
        if (!url) throw new Error(`No image URL in response. Full response: ${JSON.stringify(genData)}`);

        return res.status(200).json({ url, description });

    } catch (err) {
        console.error('[PFP Lab Error]', err.message);
        return res.status(500).json({ error: err.message });
    }
};
