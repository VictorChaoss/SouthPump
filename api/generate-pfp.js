// api/generate-pfp.js — South Pump PFP Lab Backend
// Vercel Serverless Function — maxDuration: 60 (set in vercel.json)
//
// Required env var (Vercel Dashboard → Environment Variables):
//   OPENAI_API_KEY  — must have billing enabled at platform.openai.com/billing

// ── In-memory rate limiter (resets on cold start — good enough for serverless) ──
const rateLimitMap = new Map();
const RATE_LIMIT   = 5;                  // requests per window
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

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {

    // CORS
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

    // Validate
    const { imageBase64, extraPrompt = '' } = req.body || {};
    if (!imageBase64)
        return res.status(400).json({ error: 'No image provided.' });
    if (imageBase64.length > 7_000_000)
        return res.status(400).json({ error: 'Image too large. Please use a photo under 4MB.' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        return res.status(500).json({
            error: 'OPENAI_API_KEY is not set. Go to Vercel → Settings → Environment Variables.'
        });

    const authHeader = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    try {

        // ── Step 1: Describe the person with GPT-4o Vision ──────────────────
        const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: authHeader,
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type:      'image_url',
                            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' }
                        },
                        {
                            type: 'text',
                            text: `Describe this person's physical appearance for a South Park cartoon artist. Include: hair color and style, face shape, skin tone, body build, notable features, exact clothing and accessories. Concise, max 80 words, no names.`
                        }
                    ]
                }],
                max_tokens: 160
            })
        });

        const visionData  = await visionRes.json();
        if (!visionRes.ok) {
            const msg = visionData.error?.message || '';
            if (visionRes.status === 401) throw new Error('Invalid OpenAI API key. Check OPENAI_API_KEY in Vercel.');
            if (visionRes.status === 429) throw new Error('OpenAI rate limit hit. Wait a moment and try again.');
            throw new Error(msg || `Vision step failed (${visionRes.status})`);
        }

        const description = visionData.choices?.[0]?.message?.content?.trim();
        if (!description) throw new Error('Could not read the image. Try a clearer, front-facing photo.');

        // ── Step 2: Generate South Park character with DALL-E 3 ─────────────
        const safeExtra = (extraPrompt || '').slice(0, 200);
        const prompt    = [
            'South Park cartoon style character portrait.',
            'Construction paper cutout art style.',
            'Flat 2D, thick black outlines, vibrant primary colors, simple shapes.',
            `Character: ${description}`,
            safeExtra || '',
            'White background, centered square portrait, no text, no watermarks.'
        ].filter(Boolean).join(' ');

        const genRes  = await fetch('https://api.openai.com/v1/images/generations', {
            method:  'POST',
            headers: authHeader,
            body: JSON.stringify({
                model:           'dall-e-3',
                prompt,
                n:               1,
                size:            '1024x1024',
                quality:         'standard',
                response_format: 'url'
            })
        });

        const genData = await genRes.json();
        if (!genRes.ok) {
            const msg = genData.error?.message || '';
            if (genRes.status === 401) throw new Error('Invalid OpenAI API key.');
            if (genRes.status === 403) throw new Error('OpenAI billing not enabled. Visit platform.openai.com/billing to add credits.');
            if (genRes.status === 404) throw new Error('DALL-E 3 not accessible. Ensure billing is enabled at platform.openai.com/billing.');
            if (genRes.status === 429) throw new Error('OpenAI rate limit. Wait a moment and try again.');
            throw new Error(msg || `Generation failed (${genRes.status})`);
        }

        const url = genData.data?.[0]?.url;
        if (!url) throw new Error('No image returned. Please try again.');

        return res.status(200).json({ url, description });

    } catch (err) {
        console.error('[PFP Lab]', err.message);
        return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
    }
};
