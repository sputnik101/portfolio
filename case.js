// Открытие скриншотов кейса на весь экран
(() => {
    const shots = document.querySelectorAll('.case-shot img');
    if (!shots.length) return;

    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Скриншот целиком');
    box.innerHTML = '<p class="lightbox-cap"></p><button class="lightbox-close" type="button" aria-label="Закрыть">✕</button><div class="lightbox-frame"><img alt=""></div><p class="lightbox-hint">Листайте скриншот пальцем</p>';
    document.body.appendChild(box);

    const frame = box.querySelector('.lightbox-frame');
    const big = frame.querySelector('img');
    const cap = box.querySelector('.lightbox-cap');
    const closeBtn = box.querySelector('.lightbox-close');
    let last = null;

    const open = img => {
        last = img;
        big.src = img.currentSrc || img.src;
        big.alt = img.alt;
        const fc = img.closest('figure')?.querySelector('figcaption');
        cap.textContent = fc ? fc.textContent : img.alt;
        frame.classList.remove('is-zoomed');
        const wide = window.innerWidth <= 600 && (img.naturalWidth || 0) > 800;
        frame.classList.toggle('is-wide', wide);
        box.querySelector('.lightbox-hint').hidden = !wide;
        frame.scrollTo(0, 0);
        box.classList.add('is-open');
        document.body.classList.add('lightbox-lock');
        closeBtn.focus();
    };
    const close = () => {
        box.classList.remove('is-open');
        document.body.classList.remove('lightbox-lock');
        if (last) last.focus();
    };

    shots.forEach(img => {
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.addEventListener('click', () => open(img));
        img.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
        });
    });

    // клик по картинке: если она ужата под экран — показать в натуральную величину, иначе закрыть
    big.addEventListener('click', e => {
        e.stopPropagation();
        if (frame.classList.contains('is-wide')) return;
        if (!frame.classList.contains('is-zoomed') && big.naturalWidth > big.clientWidth + 40) {
            frame.classList.add('is-zoomed');
        } else {
            close();
        }
    });
    box.addEventListener('click', e => { if (e.target === box) close(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('is-open')) close(); });
})();
