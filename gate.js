// gate.js — handles splash + profile selection, then redirects to plus.html

document.addEventListener('DOMContentLoaded', () => {
    const gate        = document.getElementById('gate');
    const splashPanel = document.getElementById('splash-panel');
    const profilePanel = document.getElementById('profile-panel');
    const profiles    = document.querySelectorAll('.profile-item');

    // Skip gate entirely if already logged in this session
    if (sessionStorage.getItem('southPumpProfile')) {
        window.location.href = 'plus.html';
        return;
    }

    // Floating red particles
    function spawnParticles() {
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
        splashPanel.style.opacity = '0';
        splashPanel.style.pointerEvents = 'none';
        profilePanel.style.transition = 'opacity 0.7s ease';
        profilePanel.style.opacity = '1';
        profilePanel.style.pointerEvents = 'auto';
    }

    function dismissGate(avatarSrc) {
        // Store selected profile avatar path too for the hub nav
        sessionStorage.setItem('southPumpAvatar', avatarSrc);
        gate.classList.add('hidden');
        setTimeout(() => { window.location.href = 'plus.html'; }, 1000);
    }

    spawnParticles();

    // Pulse at 1.7s → crossfade panels at 2.4s
    setTimeout(() => splashPanel.classList.add('pulse'), 1700);
    setTimeout(showProfilePanel, 2400);

    profiles.forEach(profile => {
        profile.addEventListener('click', () => {
            sessionStorage.setItem('southPumpProfile', profile.dataset.profile);
            profile.classList.add('clicked');
            setTimeout(() => dismissGate(profile.dataset.avatar), 350);
        });
    });
});
