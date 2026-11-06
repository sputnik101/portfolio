// ===== Меню =====
(() => {
    const toggle = document.querySelector('.menu-toggle');
    const panel = document.querySelector('.menu-panel');
    if (!toggle || !panel) return;

    const setMenu = open => {
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
    };

    toggle.addEventListener('click', () => setMenu(panel.hidden));
    panel.addEventListener('click', event => {
        if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.menu')) setMenu(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            setMenu(false);
            toggle.focus();
        }
    });
})();

// ===== Живая схема города с ускоренными сутками =====
// Сутки идут быстрее: 1 секунда = 6 минут, весь день примерно за 4 минуты.
// Старт — с текущего московского времени. В часы пик дороги краснеют, ночью пустеют.
// Это имитация, а не реальные данные: дороги нарисованы «по мотивам» Москвы.
(() => {
    const canvas = document.querySelector('.map');
    const anchor = document.querySelector('.here-pin');
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const BG = [108, 112, 247];                 // сиреневый фон первого экрана
    const COLORS = { free: '#D4F56A', slow: '#FFB36B', jam: '#FF9EC8' };
    const SPEED = { free: 1.3, slow: 0.55, jam: 0.15 };
    const SIM_MINUTES_PER_SECOND = 6;

    const clockEl = document.querySelector('.sim-clock');
    const phaseEl = document.querySelector('.sim-phase');
    const pauseBtn = document.querySelector('.sim-pause');

    let W = 0;
    let H = 0;
    let dpr = 1;
    let roads = [];
    let cars = [];
    let ground = null;     // фон, мелкие улицы, река
    let veil = null;       // растворение к краям
    let roadsLayer = null; // дороги с текущей загруженностью
    let running = false;
    let visible = true;
    let paused = false;

    // текущие московские минуты от начала суток (UTC+3)
    const now = new Date();
    let simMinutes = ((now.getUTCHours() + 3) % 24) * 60 + now.getUTCMinutes();
    let lastTick = 0;
    let lastRoadsMinute = -999;

    function random(seed) {
        return () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
    }

    const bell = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

    // загруженность города от 0 до 1 в зависимости от часа
    function intensity(hour) {
        const h = ((hour % 24) + 24) % 24;
        const wrapped = (mu, s) => Math.max(bell(h, mu, s), bell(h + 24, mu, s), bell(h - 24, mu, s));
        return Math.min(1, 0.12 + 0.85 * wrapped(8.8, 1.2) + 0.95 * wrapped(18.6, 1.5) + 0.32 * wrapped(13.5, 2.8));
    }

    function phase(hour) {
        if (hour >= 7 && hour < 10.5) return 'утренний час пик';
        if (hour >= 10.5 && hour < 16.5) return 'день';
        if (hour >= 16.5 && hour < 20.5) return 'вечерний час пик';
        if (hour >= 20.5 && hour < 23.5) return 'вечер';
        return 'ночь';
    }

    function makeRoad(points, width, rand, kind) {
        const cum = [0];
        for (let i = 1; i < points.length; i++) {
            const [x1, y1] = points[i - 1];
            const [x2, y2] = points[i];
            cum.push(cum[i - 1] + Math.hypot(x2 - x1, y2 - y1));
        }
        const o1 = rand() * 10;
        const o2 = rand() * 10;
        // постоянная «склонность к пробкам» каждого участка
        const base = [];
        for (let i = 0; i < points.length - 1; i++) {
            base.push(0.5 + 0.32 * Math.sin(i * 0.23 + o1) + 0.24 * Math.sin(i * 0.071 + o2));
        }
        return { points, cum, len: cum[cum.length - 1], width, kind, base, levels: base.map(() => 'free') };
    }

    // пересчитать уровни загруженности под текущее время
    function updateLevels(hour) {
        const I = intensity(hour);
        const morning = bell(hour, 8.8, 1.4);
        const evening = bell(hour, 18.6, 1.6);
        roads.forEach(road => {
            const n = road.base.length;
            for (let i = 0; i < n; i++) {
                let v = road.base[i] * 0.7 + I * 0.5 - 0.16;
                if (road.kind === 'radial') {
                    // утром тяжелее ближе к центру (едут в город), вечером на выезде
                    const t = i / n;
                    v += 0.14 * morning * (1 - t) + 0.14 * evening * t - 0.06;
                }
                if (road.kind === 'ring-mid') v += 0.08 * I;
                road.levels[i] = v > 0.86 ? 'jam' : v > 0.62 ? 'slow' : 'free';
            }
        });
    }

    function pointAt(road, s) {
        const { points, cum } = road;
        let lo = 0;
        let hi = cum.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] <= s) lo = mid; else hi = mid;
        }
        const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
        const [x1, y1] = points[lo];
        const [x2, y2] = points[hi];
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, lo];
    }

    function layer() {
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const g = c.getContext('2d');
        g.scale(dpr, dpr);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        return [c, g];
    }

    const rgba = a => `rgba(${BG[0]}, ${BG[1]}, ${BG[2]}, ${a})`;

    function build() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        if (!W || !H) return;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        const hostRect = canvas.getBoundingClientRect();
        const anchorRect = anchor ? anchor.getBoundingClientRect() : null;
        const hasAnchor = anchorRect && anchorRect.width > 0;
        const cx = hasAnchor ? anchorRect.left + anchorRect.width / 2 - hostRect.left : W / 2;
        const cy = hasAnchor ? anchorRect.top + 9 - hostRect.top : Math.min(H * 0.4, 250);
        const R = Math.max(W, H) * (W < 900 ? 0.75 : 0.55);
        const rand = random(11);
        const at = (a, r) => [cx + Math.cos(a) * r * 1.08, cy + Math.sin(a) * r * 0.92];

        roads = [];
        [[0.09, 2, 'ring'], [0.17, 3, 'ring-mid'], [0.3, 3.5, 'ring-mid'], [0.52, 3, 'ring'], [0.95, 4, 'ring']].forEach(([f, w, kind]) => {
            const p1 = rand() * 6;
            const p2 = rand() * 6;
            const pts = [];
            for (let i = 0; i <= 200; i++) {
                const a = (i / 200) * Math.PI * 2;
                pts.push(at(a, f * R * (1 + 0.05 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2))));
            }
            roads.push(makeRoad(pts, w, rand, kind));
        });

        for (let i = 0; i < 13; i++) {
            const a0 = (i / 13) * Math.PI * 2 + rand() * 0.2;
            const bend = (rand() - 0.5) * 0.4;
            const pts = [];
            for (let j = 0; j <= 60; j++) {
                const t = j / 60;
                pts.push(at(a0 + bend * t * t, (0.09 + t * 1.25) * R));
            }
            roads.push(makeRoad(pts, 2 + Math.round(rand() * 1.5), rand, 'radial'));
        }

        // фон, улицы, река
        let g;
        [ground, g] = layer();
        g.fillStyle = rgba(1);
        g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        g.lineWidth = 1;
        g.beginPath();
        for (let i = 0; i < 1100; i++) {
            const a = rand() * Math.PI * 2;
            const r = (0.05 + Math.sqrt(rand()) * 1.3) * R;
            const [x, y] = at(a, r);
            const dir = rand() < 0.5 ? a : a + Math.PI / 2;
            const len = 10 + rand() * 44;
            g.moveTo(x, y);
            g.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
        }
        g.stroke();
        g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        g.lineWidth = Math.max(10, R * 0.03);
        g.beginPath();
        for (let j = 0; j <= 80; j++) {
            const t = j / 80;
            const x = cx + (-1.4 + 2.8 * t) * R;
            const y = cy + R * (0.1 * Math.sin(t * 10) + 0.16 * Math.sin(t * 3.4 + 1));
            if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();

        // растворение к краям и к низу
        [veil, g] = layer();
        const fade = g.createRadialGradient(cx, cy, R * 0.18, cx, cy, Math.max(W, H) * 0.62);
        fade.addColorStop(0, rgba(0));
        fade.addColorStop(1, rgba(0.9));
        g.fillStyle = fade;
        g.fillRect(0, 0, W, H);
        const bottom = g.createLinearGradient(0, H * 0.55, 0, H);
        bottom.addColorStop(0, rgba(0));
        bottom.addColorStop(0.7, rgba(0.85));
        bottom.addColorStop(1, rgba(1));
        g.fillStyle = bottom;
        g.fillRect(0, 0, W, H);

        [roadsLayer] = layer();

        cars = [];
        const total = W < 900 ? 130 : 230;
        for (let i = 0; i < total; i++) {
            const road = roads[Math.floor(rand() * roads.length)];
            cars.push({ road, s: rand() * road.len, dir: rand() < 0.5 ? 1 : -1, rank: rand() });
        }

        lastRoadsMinute = -999;
        refreshRoads(true);
        draw(false);
    }

    // перерисовать дороги, если время заметно сдвинулось
    function refreshRoads(force) {
        if (!force && Math.abs(simMinutes - lastRoadsMinute) < 3) return;
        lastRoadsMinute = simMinutes;
        updateLevels(simMinutes / 60);

        const g = roadsLayer.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, roadsLayer.width, roadsLayer.height);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.lineCap = 'round';
        g.lineJoin = 'round';

        roads.forEach(road => {
            g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            g.lineWidth = road.width + 3;
            g.beginPath();
            road.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.stroke();

            let start = 0;
            for (let i = 1; i <= road.levels.length; i++) {
                if (i === road.levels.length || road.levels[i] !== road.levels[start]) {
                    g.strokeStyle = COLORS[road.levels[start]];
                    g.lineWidth = road.width;
                    g.beginPath();
                    for (let k = start; k <= i; k++) {
                        const [x, y] = road.points[k];
                        if (k === start) g.moveTo(x, y); else g.lineTo(x, y);
                    }
                    g.stroke();
                    start = i;
                }
            }
        });

        updateClock();
    }

    function updateClock() {
        const total = Math.floor(simMinutes) % 1440;
        const hh = String(Math.floor(total / 60)).padStart(2, '0');
        const mm = String(total % 60).padStart(2, '0');
        if (clockEl) clockEl.textContent = `${hh}:${mm}`;
        if (phaseEl) phaseEl.textContent = phase(total / 60);
    }

    function draw(move) {
        if (!ground) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(ground, 0, 0);
        ctx.drawImage(roadsLayer, 0, 0);
        ctx.drawImage(veil, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // ночью на дорогах меньше машин
        const share = 0.3 + 0.7 * intensity(simMinutes / 60);

        ctx.fillStyle = '#FFFFFF';
        for (const band of [0.9, 0.45]) {
            ctx.globalAlpha = band;
            ctx.beginPath();
            cars.forEach(car => {
                if (car.rank > share) return;
                if (move && band === 0.9) {
                    const level = car.road.levels[pointAt(car.road, car.s)[2]];
                    car.s += SPEED[level] * car.dir;
                    if (car.s < 0) car.s += car.road.len;
                    if (car.s > car.road.len) car.s -= car.road.len;
                }
                const [x, y] = pointAt(car.road, car.s);
                const near = y < H * 0.62 && x > W * 0.12 && x < W * 0.88;
                if ((band === 0.9) !== near) return;
                ctx.moveTo(x + 1.8, y);
                ctx.arc(x, y, 1.8, 0, Math.PI * 2);
            });
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function loop(time) {
        if (!running) return;
        if (lastTick) {
            const dt = Math.min(time - lastTick, 100) / 1000;
            if (!paused) {
                simMinutes = (simMinutes + dt * SIM_MINUTES_PER_SECOND) % 1440;
                refreshRoads(false);
            }
        }
        lastTick = time;
        draw(!paused);
        requestAnimationFrame(loop);
    }

    function start() {
        if (reduceMotion || running || !visible || document.hidden) return;
        running = true;
        lastTick = 0;
        requestAnimationFrame(loop);
    }

    function stop() {
        running = false;
    }

    if (pauseBtn) {
        if (reduceMotion) {
            pauseBtn.hidden = true;
        } else {
            pauseBtn.addEventListener('click', () => {
                paused = !paused;
                pauseBtn.setAttribute('aria-pressed', String(paused));
                pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
            });
        }
    }

    build();
    start();

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (canvas.clientWidth !== W || canvas.clientHeight !== H) build();
        }, 150);
    });

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            visible = entries[0].isIntersecting;
            if (visible) start(); else stop();
        }).observe(canvas);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop(); else start();
    });
})();

// ===== Линия маршрута прочерчивается, когда схема появляется на экране =====
(() => {
    const route = document.querySelector('.route');
    if (!route || !('IntersectionObserver' in window)) return;

    route.querySelectorAll('.stop').forEach((stop, i) => stop.style.setProperty('--i', i));
    route.classList.add('will-draw');

    const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
            requestAnimationFrame(() => requestAnimationFrame(() => route.classList.add('is-drawn')));
            observer.disconnect();
        }
    }, { threshold: 0.35 });

    observer.observe(route);
})();
