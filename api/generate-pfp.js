// api/generate-pfp.js — South Pump PFP Lab Backend
// Vercel Serverless Function
// Env vars required: OPENROUTER_API_KEY

// ── Simple in-memory rate limiter ──────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT   = 5;           // max requests per window
const RATE_WINDOW  = 10 * 60 * 1000; // 10 minutes in ms

function checkRateLimit(ip) {
    const now   = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
        return { allowed: true, remaining: RATE_LIMIT - 1 };
    }
    if (entry.count >= RATE_LIMIT) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return { allowed: false, retryAfter };
    }
    entry.count++;
    return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

// ── Serverless handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    // ── Rate limit check ──────────────────────────────────────────────────
    const ip     = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                 || req.socket?.remoteAddress
                 || 'unknown';
    const limit  = checkRateLimit(ip);

    if (!limit.allowed) {
        return res.status(429).json({
            error: `Too many requests. Try again in ${limit.retryAfter} seconds.`,
            retryAfter: limit.retryAfter
        });
    }

    // ── Validate payload ──────────────────────────────────────────────────
    const { imageBase64, extraPrompt = '' } = req.body || {};

    if (!imageBase64)
        return res.status(400).json({ error: 'No image provided.' });

    // ~5MB base64 limit — keeps API calls reasonable
    if (imageBase64.length > 7_000_000)
        return res.status(400).json({ error: 'Image too large. Please use a photo under 4MB.' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
        return res.status(500).json({ error: 'API not configured on server.' });

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://southpump.fun',
        'X-Title':       'South Pump PFP Lab'
    };

    try {

        // ── Step 1: Vision analysis (GPT-4o via OpenRouter) ──────────────
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
                            image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
                        },
                        {
                            type: 'text',
                            text: `Describe this person's physical appearance so an artist can recreate them as a South Park cartoon character. Include: face shape, hair color and style, skin tone, body build, notable facial features, and the exact clothing and accessories visible. Be precise and concise. Maximum 80 words. Do not include names or identify the person.`
                        }
                    ]
                }],
                max_tokens: 160
            })
        });

        if (!visionRes.ok) {
            const err = await visionRes.json().catch(() => ({}));
            throw new Error(err.error?.message || `Vision API error (${visionRes.status})`);
        }

        const visionData  = await visionRes.json();
        const description = visionData.choices?.[0]?.message?.content || '';

        if (!description)
            throw new Error('Could not analyse the image. Please try a clearer photo.');

        // ── Step 2: Generate South Park PFP (DALL-E 3 via OpenRouter) ──────
        const safeExtra    = extraPrompt.slice(0, 200); // cap extra prompt length
        const dallePrompt  = [
            'South Park cartoon style character portrait.',
            'Construction paper cutout animation aesthetic.',
            'Flat 2D art, thick black outlines, vibrant primary colors, simple shapes.',
            `The character: ${description}`,
            safeExtra ? `Additional details: ${safeExtra}.` : '',
            'Centered square portrait, plain white background, no text, no watermarks.',
            'Authentic South Park art style. High quality.'
        ].filter(Boolean).join(' ');

        const imageRes = await fetch('https://openrouter.ai/api/v1/images/generations', {
            method:  'POST',
            headers,
            body: JSON.stringify({
                model:           'openai/dall-e-3',
                prompt:          dallePrompt,
                n:               1,
                size:            '1024x1024',
                quality:         'hd',
                response_format: 'url'
            })
        });

        if (!imageRes.ok) {
            const err = await imageRes.json().catch(() => ({}));
            throw new Error(err.error?.message || `Image generation error (${imageRes.status})`);
        }

        const imageData = await imageRes.json();
        const url       = imageData.data?.[0]?.url;

        if (!url)
            throw new Error('No image URL returned from generation API.');

        return res.status(200).json({ url, description });

    } catch (err) {
        console.error('[PFP Lab] Error:', err.message);
        return res.status(500).json({
            error: err.message || 'Generation failed. Please try again.'
        });
    }
}
