document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const promptInput = document.getElementById('prompt-input');
    const apiKeyInput = document.getElementById('api-key');
    const imageFrame = document.getElementById('image-frame');
    const loader = document.getElementById('loader');

    // ─── Unified Gate Logic ────────────────────────────────────────
    const gate         = document.getElementById('gate');
    const splashPanel  = document.getElementById('splash-panel');
    const profilePanel = document.getElementById('profile-panel');
    const profiles     = document.querySelectorAll('.profile-item');

    function spawnParticles() {
        if (!gate) return;
        for (let i = 0; i < 18; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.cssText = `
                left: ${Math.random() * 100}vw;
                top: ${Math.random() * 100}vh;
                width: ${Math.random() * 4 + 2}px;
                height: ${Math.random() * 4 + 2}px;
                animation-duration: ${Math.random() * 5 + 4}s;
                animation-delay: ${Math.random() * 4}s;
                opacity: ${Math.random() * 0.5 + 0.2};
            `;
            gate.appendChild(p);
        }
    }

    function showProfilePanel() {
        // Fade splash out, profile in — gate background stays solid the whole time
        splashPanel.style.opacity = '0';
        splashPanel.style.pointerEvents = 'none';
        profilePanel.style.opacity = '1';
        profilePanel.style.pointerEvents = 'auto';
    }

    function dismissGate() {
        gate.classList.add('hidden');
        setTimeout(() => { window.location.href = 'plus.html'; }, 1000);
    }

    if (gate) {
        if (sessionStorage.getItem('southPumpProfile')) {
            gate.style.display = 'none';
        } else {
            spawnParticles();

            // Pulse at 1.7s, then crossfade panels at 2.4s
            setTimeout(() => { splashPanel.classList.add('pulse'); }, 1700);
            setTimeout(showProfilePanel, 2400);

            profiles.forEach(profile => {
                profile.addEventListener('click', () => {
                    sessionStorage.setItem('southPumpProfile', profile.getAttribute('data-profile'));
                    profile.classList.add('clicked');
                    setTimeout(dismissGate, 350);
                });
            });
        }
    }

    generateBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const userPrompt = promptInput.value.trim();

        if (!apiKey) {
            alert('Please enter your API key first.');
            return;
        }

        if (!userPrompt) {
            alert('Please describe your alter-ego.');
            return;
        }

        // Show loading state
        imageFrame.innerHTML = '';
        loader.style.display = 'block';
        imageFrame.appendChild(loader);
        generateBtn.disabled = true;
        generateBtn.textContent = 'MINTING...';

        try {
            // The master aesthetic prompt to ensure South Park style
            const masterPrompt = `South Park style construction paper cutout animation style, flat primary colors, 2D vector look. A character matching this description: ${userPrompt}. No text. Snowy ground in the foreground.`;

            // Call OpenAI DALL-E 3 API
            const response = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: masterPrompt,
                    n: 1,
                    size: "1024x1024",
                    response_format: "url"
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'Failed to generate image');
            }

            const imageUrl = data.data[0].url;

            // Display the image
            loader.style.display = 'none';
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'Generated South Pump Character';
            
            // Wait for image to load to avoid flashing
            img.onload = () => {
                imageFrame.innerHTML = '';
                imageFrame.appendChild(img);
            };

        } catch (error) {
            console.error('Generation Error:', error);
            loader.style.display = 'none';
            imageFrame.innerHTML = `<div class="placeholder-text" style="color: red; font-size: 1.2rem; text-align: center; padding: 1rem;">Error:<br>${error.message}</div>`;
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'MINT PFP';
        }
    });
});
