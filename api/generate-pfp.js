// api/generate-pfp.js — South Pump PFP Lab Backend
// Vercel Serverless Function
// Env vars required:
//   OPENROUTER_API_KEY  — vision analysis (GPT-4o via OpenRouter)
//
// Image generation uses Pollinations.ai (free, no key needed)

// ── Simple in-memory rate limiter ──────────────────────────────────────────
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

// ── Serverless handler ──────────────────────────────────────────────────────
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
            error: `Too many requests. Try again in ${limit.retryAfter} seconds.`,
            retryAfter: limit.retryAfter
        });
    }

    const { imageBase64, extraPrompt = '' } = req.body || {};
    if (!imageBase64)
        return res.status(400).json({ error: 'No image provided.' });
    if (imageBase64.length > 7_000_000)
        return res.status(400).json({ error: 'Image too large. Please use a photo under 4MB.' });

    const orKey = process.env.OPENROUTER_API_KEY;
    if (!orKey)
        return res.status(500).json({ error: 'API not configured on server.' });

    try {

        // ── Step 1: Vision analysis via OpenRouter (GPT-4o) ──────────────────
        const visionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${orKey}`,
                'Content-Type':  'application/json',
                'HTTP-Referer':  'https://southpump.fun',
                'X-Title':       'South Pump PFP Lab'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o',
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type:      'image_url',
                            image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
                        },
                        {
                            type: 'text',
                            text: `Describe this person's physical appearance so an artist can recreate them as a South Park cartoon character. Include: face shape, hair color and style, skin tone, body build, notable facial features, and the exact clothing and accessories visible. Be precise and concise. Maximum 80 words. Do not include any real names.`
                        }
                    ]
                }],
                max_tokens: 160
            })
        });

        if (!visionRes.ok) {
            const err = await visionRes.json().catch(() => ({}));
            throw new Error(err.error?.message || `Vision analysis failed (${visionRes.status})`);
        }

        const visionData  = await visionRes.json();
        const description = visionData.choices?.[0]?.message?.content || '';
        if (!description)
            throw new Error('Could not analyse the image. Please try a clearer photo.');

        // ── Step 2: Generate South Park PFP via Pollinations.ai (FLUX model) ─
        const safeExtra   = extraPrompt.slice(0, 200);
        const fullPrompt  = [
            'South Park cartoon style character portrait.',
            'Construction paper cutout animation aesthetic.',
            'Flat 2D art, thick black outlines, vibrant primary colors, simple shapes.',
            `Character appearance: ${description}`,
            safeExtra ? safeExtra : '',
            'Centered square portrait, clean white background, no text.',
            'Authentic South Park art style, high quality.'
        ].filter(Boolean).join(' ');

        // Pollinations.ai — free image gen, no key needed, deterministic by seed
        const seed      = Math.floor(Math.random() * 999999);
        const encoded   = encodeURIComponent(fullPrompt);
        const imageUrl  = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;

        // Verify the URL is reachable (HEAD request)
        const checkRes = await fetch(imageUrl, { method: 'HEAD' });
        if (!checkRes.ok) {
            throw new Error(`Image service unavailable (${checkRes.status}). Please try again.`);
        }

        return res.status(200).json({ url: imageUrl, description });

    } catch (err) {
        console.error('[PFP Lab]', err.message);
        return res.status(500).json({ error: err.message || 'Generation failed. Please try again.' });
    }
};
