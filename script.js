// ===== Живая схема города на первом экране =====
// Кольца и радиальные магистрали в духе Москвы, река, мелкие улицы.
// Дороги подкрашены по загруженности, по ним едут машины: в пробках медленнее.
(() => {
    const canvas = document.querySelector('.map');
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const COLORS = { free: '#3DD68C', slow: '#FFC14A', jam: '#FF5E5E' };
    const SPEED = { free: 1.4, slow: 0.6, jam: 0.18 };

    let W = 0;
    let H = 0;
    let dpr = 1;
    let roads = [];
    let cars = [];
    let base = null;      // заранее отрисованный слой с дорогами
    let running = false;
    let visible = true;

    // предсказуемый генератор случайных чисел: карта одинаковая при каждой загрузке
    function random(seed) {
        return () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
    }

    function makeRoad(points, width, rand) {
        const cum = [0];
        for (let i = 1; i < points.length; i++) {
            const [x1, y1] = points[i - 1];
            const [x2, y2] = points[i];
            cum.push(cum[i - 1] + Math.hypot(x2 - x1, y2 - y1));
        }
        const o1 = rand() * 10;
        const o2 = rand() * 10;
        const levels = [];
        for (let i = 0; i < points.length - 1; i++) {
            const v = 0.5 + 0.32 * Math.sin(i * 0.23 + o1) + 0.24 * Math.sin(i * 0.071 + o2);
            levels.push(v > 0.86 ? 'jam' : v > 0.62 ? 'slow' : 'free');
        }
        return { points, cum, len: cum[cum.length - 1], width, levels };
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

    function build() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        if (!W || !H) return;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        const narrow = W < 900;
        const cx = narrow ? W * 0.55 : W * 0.6;
        const cy = narrow ? H * 0.2 : H * 0.44;
        const R = Math.max(W, H) * (narrow ? 0.8 : 0.6);
        const sx = 1.08;
        const sy = 0.92;
        const rand = random(11);
        const at = (a, r) => [cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy];

        roads = [];

        // кольца: от Бульварного до МКАД
        [[0.07, 3], [0.14, 4], [0.27, 5], [0.5, 4], [0.95, 6]].forEach(([f, w]) => {
            const p1 = rand() * 6;
            const p2 = rand() * 6;
            const pts = [];
            for (let i = 0; i <= 200; i++) {
                const a = (i / 200) * Math.PI * 2;
                pts.push(at(a, f * R * (1 + 0.05 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2))));
            }
            roads.push(makeRoad(pts, w, rand));
        });

        // радиальные магистрали
        const count = 13;
        for (let i = 0; i < count; i++) {
            const a0 = (i / count) * Math.PI * 2 + rand() * 0.2;
            const bend = (rand() - 0.5) * 0.4;
            const pts = [];
            for (let j = 0; j <= 60; j++) {
                const t = j / 60;
                pts.push(at(a0 + bend * t * t, (0.07 + t * 1.25) * R));
            }
            roads.push(makeRoad(pts, 3 + Math.round(rand() * 2), rand));
        }

        // фон: заливка, мелкие улицы, река, дороги с загруженностью
        base = document.createElement('canvas');
        base.width = canvas.width;
        base.height = canvas.height;
        const b = base.getContext('2d');
        b.scale(dpr, dpr);

        b.fillStyle = '#0E1430';
        b.fillRect(0, 0, W, H);

        b.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        b.lineWidth = 1;
        b.beginPath();
        for (let i = 0; i < 1100; i++) {
            const a = rand() * Math.PI * 2;
            const r = (0.04 + Math.sqrt(rand()) * 1.3) * R;
            const [x, y] = at(a, r);
            const dir = rand() < 0.5 ? a : a + Math.PI / 2;
            const len = 10 + rand() * 44;
            b.moveTo(x, y);
            b.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
        }
        b.stroke();

        // река
        b.strokeStyle = '#1A2858';
        b.lineWidth = Math.max(10, R * 0.03);
        b.lineCap = 'round';
        b.lineJoin = 'round';
        b.beginPath();
        for (let j = 0; j <= 80; j++) {
            const t = j / 80;
            const x = cx + (-1.4 + 2.8 * t) * R;
            const y = cy + R * (0.1 * Math.sin(t * 10) + 0.16 * Math.sin(t * 3.4 + 1));
            if (j === 0) b.moveTo(x, y); else b.lineTo(x, y);
        }
        b.stroke();

        roads.forEach(road => {
            b.strokeStyle = '#26305E';
            b.lineWidth = road.width + 3;
            b.beginPath();
            road.points.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
            b.stroke();

            // участки одного уровня загруженности рисуем одной линией
            let start = 0;
            for (let i = 1; i <= road.levels.length; i++) {
                if (i === road.levels.length || road.levels[i] !== road.levels[start]) {
                    b.strokeStyle = COLORS[road.levels[start]];
                    b.globalAlpha = 0.55;
                    b.lineWidth = road.width;
                    b.beginPath();
                    for (let k = start; k <= i; k++) {
                        const [x, y] = road.points[k];
                        if (k === start) b.moveTo(x, y); else b.lineTo(x, y);
                    }
                    b.stroke();
                    start = i;
                }
            }
            b.globalAlpha = 1;
        });

        // затемнение по краям и слева, чтобы текст на панелях читался
        const v = b.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(W, H));
        v.addColorStop(0, 'rgba(14, 20, 48, 0)');
        v.addColorStop(1, 'rgba(14, 20, 48, 0.75)');
        b.fillStyle = v;
        b.fillRect(0, 0, W, H);

        if (!narrow) {
            const l = b.createLinearGradient(0, 0, W * 0.55, 0);
            l.addColorStop(0, 'rgba(14, 20, 48, 0.55)');
            l.addColorStop(1, 'rgba(14, 20, 48, 0)');
            b.fillStyle = l;
            b.fillRect(0, 0, W, H);
        }

        // машины
        cars = [];
        const total = narrow ? 140 : 260;
        for (let i = 0; i < total; i++) {
            const road = roads[Math.floor(rand() * roads.length)];
            cars.push({ road, s: rand() * road.len, dir: rand() < 0.5 ? 1 : -1 });
        }

        draw(false);
    }

    function draw(move) {
        if (!base) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(base, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'rgba(238, 240, 250, 0.9)';
        ctx.beginPath();
        cars.forEach(car => {
            if (move) {
                const level = car.road.levels[pointAt(car.road, car.s)[2]];
                car.s += SPEED[level] * car.dir;
                if (car.s < 0) car.s += car.road.len;
                if (car.s > car.road.len) car.s -= car.road.len;
            }
            const [x, y] = pointAt(car.road, car.s);
            if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
            ctx.moveTo(x + 2.1, y);
            ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        });
        ctx.fill();
    }

    function loop() {
        if (!running) return;
        draw(true);
        requestAnimationFrame(loop);
    }

    function start() {
        if (reduceMotion || running || !visible) return;
        running = true;
        requestAnimationFrame(loop);
    }

    function stop() {
        running = false;
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

    // не тратим ресурсы, когда карта за пределами экрана или вкладка скрыта
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
