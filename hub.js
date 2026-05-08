// hub.js — South Pump+ main hub logic

document.addEventListener('DOMContentLoaded', () => {

    // ── Load profile from session ──────────────────────────────────
    const profileName   = sessionStorage.getItem('southPumpProfile');
    const avatarSrc     = sessionStorage.getItem('southPumpAvatar');
    const navAvatar     = document.getElementById('nav-avatar');
    const navName       = document.getElementById('nav-name');

    // If they hit plus.html directly without going through the gate, send them back
    if (!profileName) {
        window.location.href = 'index.html';
        return;
    }

    if (avatarSrc && navAvatar) navAvatar.src = avatarSrc;
    if (profileName && navName) navName.textContent = profileName;

    // ── Sticky header on scroll ────────────────────────────────────
    const header = document.getElementById('main-header');
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 60);
    });

    // ── Smooth scroll for nav links ────────────────────────────────
    document.querySelectorAll('.streaming-nav a[href^="#"]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ── Mobile nav overlay ─────────────────────────────────────────
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
        // Build overlay from existing nav links
        const navLinks = document.querySelectorAll('.streaming-nav a');
        const overlay  = document.createElement('div');
        overlay.className = 'mobile-nav-overlay';
        overlay.innerHTML = `
            <button class="mobile-nav-close" id="mobile-nav-close">&#10005;</button>
            <nav class="mobile-nav-links">
                ${Array.from(navLinks).map(a =>
                    `<a href="${a.href}" ${a.classList.contains('nav-active') ? 'class="nav-active"' : ''}>${a.textContent}</a>`
                ).join('')}
            </nav>
            <div class="mobile-nav-footer">
                <a href="https://twitter.com" target="_blank">𝕏 Twitter</a>
                <a href="https://t.me" target="_blank">✈ Telegram</a>
            </div>`;
        document.body.appendChild(overlay);

        hamburger.addEventListener('click', () => {
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });

        document.getElementById('mobile-nav-close').addEventListener('click', () => {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        });

        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

    // ── PFP Lab ────────────────────────────────────────────────────
    const generateBtn = document.getElementById('generate-btn');
    const promptInput = document.getElementById('prompt-input');
    const apiKeyInput = document.getElementById('api-key');
    const imageFrame  = document.getElementById('image-frame');
    const loader      = document.getElementById('loader');

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const apiKey     = apiKeyInput.value.trim();
            const userPrompt = promptInput.value.trim();

            if (!apiKey)     { alert('Please enter your API key first.'); return; }
            if (!userPrompt) { alert('Please describe your alter-ego.');   return; }

            // Loading state
            document.querySelector('.pfp-placeholder') && (document.querySelector('.pfp-placeholder').style.display = 'none');
            loader.style.display = 'block';
            generateBtn.disabled = true;
            generateBtn.textContent = 'MINTING...';

            try {
                const masterPrompt = `South Park style construction paper cutout animation, flat primary colors, 2D vector look. A character: ${userPrompt}. No text. Snowy ground.`;

                const response = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'dall-e-3',
                        prompt: masterPrompt,
                        n: 1,
                        size: '1024x1024',
                        response_format: 'url'
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || 'Generation failed');

                loader.style.display = 'none';
                const img = document.createElement('img');
                img.src = data.data[0].url;
                img.alt = 'Generated PFP';
                img.onload = () => { imageFrame.innerHTML = ''; imageFrame.appendChild(img); };

            } catch (err) {
                loader.style.display = 'none';
                imageFrame.innerHTML = `<div class="pfp-error">Error: ${err.message}</div>`;
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = '★ MINT PFP';
            }
        });
    }
});

// ── CA copy (global so inline onclick works) ──────────────────
function copyCa() {
    const ca = document.getElementById('ca-display').textContent.trim();
    if (ca === 'Coming Soon — Stay Tuned') return;

    navigator.clipboard.writeText(ca).then(() => {
        const btn = document.getElementById('ca-copy');
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = '📋 Copy';
            btn.classList.remove('copied');
        }, 2000);
    });
}
