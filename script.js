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
    // скорость: сколько минут схемы проходит за секунду
    const SPEEDS = [
        { m: 1, label: 'сутки за 24 мин' },
        { m: 3, label: 'сутки за 8 мин' },
        { m: 6, label: 'сутки за 4 мин' },
        { m: 15, label: 'сутки за 96 с' },
        { m: 30, label: 'сутки за 48 с' }
    ];
    let simSpeed = 6;

    // планы работы светофоров по времени суток (часы как у подписи фазы дня)
    // ray / ring — зелёный по лучу и по кольцу, секунды
    const PLANS = [
        { key: 'night', name: 'ночной', from: 23.5, to: 7, cycle: 60, ray: 30, ring: 24, color: '#3D41B8' },
        { key: 'morning', name: 'утренний пик', from: 7, to: 10.5, cycle: 120, ray: 72, ring: 40, color: '#FFB36B' },
        { key: 'day', name: 'дневной', from: 10.5, to: 16.5, cycle: 90, ray: 46, ring: 38, color: '#D4F56A' },
        { key: 'evening-peak', name: 'вечерний пик', from: 16.5, to: 20.5, cycle: 120, ray: 72, ring: 40, color: '#FF9EC8' },
        { key: 'evening', name: 'вечерний', from: 20.5, to: 23.5, cycle: 80, ray: 42, ring: 32, color: '#9AD8FF' }
    ];
    const planAt = hour => PLANS.find(pl => (pl.from < pl.to ? hour >= pl.from && hour < pl.to : hour >= pl.from || hour < pl.to)) || PLANS[2];
    const hhmm = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

    const clockEl = document.querySelector('.sim-clock');
    const phaseEl = document.querySelector('.sim-phase');
    const pauseBtn = document.querySelector('.sim-pause');
    const speedInput = document.querySelector('.sim-speed-input');
    const speedNote = document.querySelector('.sim-note');
    const planBar = document.querySelector('.sim-plan-bar');
    const planNow = document.querySelector('.sim-plan-now');
    const planName = document.querySelector('.sim-plan-name');

    // полоска суток: отрезки планов
    if (planBar) {
        PLANS.forEach(pl => {
            const parts = pl.from < pl.to ? [[pl.from, pl.to]] : [[pl.from, 24], [0, pl.to]];
            parts.forEach(([a, b]) => {
                const seg = document.createElement('span');
                seg.style.left = `${(a / 24) * 100}%`;
                seg.style.width = `${((b - a) / 24) * 100}%`;
                seg.style.background = pl.color;
                seg.title = `${pl.name}: ${hhmm(pl.from)}–${hhmm(pl.to)}`;
                planBar.insertBefore(seg, planNow);
            });
        });
    }

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
            const ring = makeRoad(pts, w, rand, kind);
            Object.assign(ring, { f, p1, p2 });
            roads.push(ring);
        });

        for (let i = 0; i < 13; i++) {
            const a0 = (i / 13) * Math.PI * 2 + rand() * 0.2;
            const bend = (rand() - 0.5) * 0.4;
            const pts = [];
            for (let j = 0; j <= 60; j++) {
                const t = j / 60;
                pts.push(at(a0 + bend * t * t, (0.09 + t * 1.25) * R));
            }
            const ray = makeRoad(pts, 2 + Math.round(rand() * 1.5), rand, 'radial');
            Object.assign(ray, { a0, bend, num: i + 1 });
            roads.push(ray);
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
        placeLights({ cx, cy, R, at });
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
        if (planNow) planNow.style.left = `${(total / 1440) * 100}%`;
        if (planName) planName.textContent = planAt(total / 60).name;
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
                simMinutes = (simMinutes + dt * simSpeed) % 1440;
                lightClock += dt;
                refreshRoads(false);
                tickLights();
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

    // ===== Светофоры на перекрёстках колец и лучей =====
    // Демо: данные выдуманы, но связаны со схемой — загрузка берётся с дорог, цикл зависит от часа.
    const RING_NAMES = { 0.17: 'Садовое кольцо', 0.3: 'ТТК' };
    const SIGNAL = {
        green: { color: '#7BE36B', label: 'зелёный' },
        yellow: { color: '#FFD24A', label: 'жёлтый' },
        red: { color: '#FF5C7A', label: 'красный' },
        flash: { color: '#FFD24A', label: 'жёлтый мигающий' }
    };
    const LEVEL_LABEL = { free: 'свободно', slow: 'плотно', jam: 'пробка' };
    const hero = canvas.closest('.hero');
    let lights = [];
    let lightClock = 0;
    let tlLayer = null;
    let card = null;
    let openLight = null;

    function signalOf(light) {
        const plan = planAt(simMinutes / 60);
        // ночью светофоры «по плану» переходят на жёлтый мигающий
        if (plan.key === 'night' && !light.adaptive) return 'flash';
        // демо-цикл 10 секунд в тех же пропорциях, что и план: зелёный по лучу, жёлтый, красный
        const green = (plan.ray / plan.cycle) * 10;
        const t = (lightClock + light.offset) % 10;
        return t < green ? 'green' : t < green + 0.8 ? 'yellow' : 'red';
    }

    function ringRadius(ring, a, R) {
        return ring.f * R * (1 + 0.05 * Math.sin(3 * a + ring.p1) + 0.03 * Math.sin(5 * a + ring.p2));
    }

    function placeLights({ R, at }) {
        if (!hero) return;
        if (!tlLayer) {
            tlLayer = document.createElement('div');
            tlLayer.className = 'tl-layer';
            canvas.after(tlLayer);
        }
        closeCard();
        tlLayer.innerHTML = '';
        lights = [];

        const heroRect = hero.getBoundingClientRect();
        const avoid = [...hero.querySelectorAll('.callout, .map-meta, .here, .hero-bottom, .sim')]
            .map(el => el.getBoundingClientRect())
            .filter(r => r.width > 0)
            .map(r => ({ l: r.left - heroRect.left - 30, r: r.right - heroRect.left + 30, t: r.top - heroRect.top - 30, b: r.bottom - heroRect.top + 30 }));
        const blocked = (x, y) => avoid.some(b => x > b.l && x < b.r && y > b.t && y < b.b);
        const mobile = W < 900;
        const maxY = mobile ? Math.min(H * 0.42, 330) : H * 0.6;
        const limit = mobile ? 4 : 8;

        const rings = roads.filter(r => r.f === 0.17 || r.f === 0.3);
        const rays = roads.filter(r => r.kind === 'radial');
        const candidates = [];
        rings.forEach(ring => rays.forEach(ray => {
            const g = t => (0.09 + 1.25 * t) * R - ringRadius(ring, ray.a0 + ray.bend * t * t, R);
            let lo = 0;
            let hi = 1;
            for (let k = 0; k < 30; k++) {
                const mid = (lo + hi) / 2;
                if (g(mid) < 0) lo = mid; else hi = mid;
            }
            const t = (lo + hi) / 2;
            const a = ray.a0 + ray.bend * t * t;
            const [x, y] = at(a, (0.09 + 1.25 * t) * R);
            if (x < W * 0.06 || x > W * 0.94 || y < 84 || y > maxY || blocked(x, y)) return;
            const ringIdx = Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 200) % 200;
            candidates.push({ x, y, ring, ray, ringIdx: Math.min(ringIdx, ring.levels.length - 1), rayIdx: Math.min(Math.round(t * 60), ray.levels.length - 1) });
        }));

        // разрежаем, чтобы маркеры не слипались
        candidates.sort((p, q) => p.y - q.y);
        candidates.forEach(c => {
            if (lights.length >= limit) return;
            if (lights.some(l => Math.hypot(l.x - c.x, l.y - c.y) < 90)) return;
            lights.push(c);
        });

        lights.forEach((light, i) => {
            light.id = 1040 + light.ray.num * 7 + (light.ring.f === 0.3 ? 3 : 0);
            light.name = `${RING_NAMES[light.ring.f]} × луч ${light.ray.num}`;
            light.adaptive = i % 3 !== 2;
            light.offset = (i * 3.7) % 10;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tl';
            btn.style.left = `${light.x}px`;
            btn.style.top = `${light.y}px`;
            btn.setAttribute('aria-label', `Светофор: ${light.name}. Открыть карточку`);
            btn.setAttribute('aria-expanded', 'false');
            btn.innerHTML = '<span class="tl-body"><i data-s="red"></i><i data-s="yellow"></i><i data-s="green"></i></span>';
            btn.addEventListener('click', event => {
                event.stopPropagation();
                if (openLight === light) closeCard(); else openCard(light);
            });
            light.btn = btn;
            tlLayer.appendChild(btn);
        });
        tickLights();
    }

    function lightData(light) {
        const hour = simMinutes / 60;
        const I = intensity(hour);
        const order = ['free', 'slow', 'jam'];
        const level = order[Math.max(order.indexOf(light.ring.levels[light.ringIdx]), order.indexOf(light.ray.levels[light.rayIdx]))];
        const plan = planAt(hour);
        // адаптивный светофор поправляет план по детекторам: при пробке цикл длиннее, на пустой дороге короче
        const delta = light.adaptive ? { free: -8, slow: 4, jam: 12 }[level] : 0;
        const cycle = plan.cycle + delta;
        const ray = plan.ray + (light.adaptive ? Math.round(delta * 0.7) : 0);
        const ring = plan.ring + (light.adaptive ? delta - Math.round(delta * 0.7) : 0);
        const minute = Math.floor(simMinutes);
        const jitter = ((light.id * 31 + minute * 7) % 5);
        const queue = level === 'jam' ? 16 + jitter * 3 : level === 'slow' ? 6 + jitter : jitter;
        return { level, cycle, queue, plan, ray, ring, I };
    }

    function tickLights() {
        lights.forEach(light => {
            const s = signalOf(light);
            if (light.signal !== s) {
                light.signal = s;
                light.btn.dataset.signal = s;
            }
        });
        if (openLight) fillCard(openLight);
    }

    function fillCard(light) {
        const { level, cycle, queue, plan, ray, ring } = lightData(light);
        const s = SIGNAL[light.signal];
        card.querySelector('.tl-signal').innerHTML = `<i style="background:${s.color}"></i>${s.label}`;
        card.querySelector('[data-k="mode"]').textContent = light.adaptive ? 'адаптивный: план + детекторы' : 'строго по плану';
        card.querySelector('[data-k="plan"]').innerHTML = `<i style="background:${plan.color}"></i>${plan.name}, ${hhmm(plan.from)}–${hhmm(plan.to)}`;
        const flash = plan.key === 'night' && !light.adaptive;
        card.querySelector('[data-k="cycle"]').textContent = flash
            ? 'отключён до 07:00'
            : light.adaptive && cycle !== plan.cycle
                ? `${cycle} с (по плану ${plan.cycle} с)`
                : `${cycle} с`;
        card.querySelector('[data-k="split"]').textContent = flash ? '—' : `луч ${ray} с · кольцо ${ring} с`;
        card.querySelector('[data-k="load"]').innerHTML = `<i style="background:${COLORS[level]}"></i>${LEVEL_LABEL[level]}`;
        card.querySelector('[data-k="queue"]').textContent = queue ? `≈ ${queue} авт.` : 'нет';
    }

    function openCard(light) {
        closeCard();
        openLight = light;
        card = document.createElement('div');
        card.className = 'tl-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', `Светофорный объект ${light.id}`);
        card.innerHTML = `
            <div class="tl-card-head">
                <span class="tl-signal"></span>
                <button type="button" class="tl-close" aria-label="Закрыть">✕</button>
            </div>
            <p class="tl-id">Светофорный объект № ${light.id}</p>
            <p class="tl-name">${light.name}</p>
            <dl>
                <div><dt>План</dt><dd data-k="plan"></dd></div>
                <div><dt>Режим</dt><dd data-k="mode"></dd></div>
                <div><dt>Цикл</dt><dd data-k="cycle"></dd></div>
                <div><dt>Зелёный</dt><dd data-k="split"></dd></div>
                <div><dt>Загрузка</dt><dd data-k="load"></dd></div>
                <div><dt>Очередь</dt><dd data-k="queue"></dd></div>
            </dl>
            <p class="tl-note">Демо-данные на схеме. <a href="case-voicelink.html">Как это устроено в настоящей ГИС →</a></p>`;
        tlLayer.appendChild(card);
        card.querySelector('.tl-close').addEventListener('click', () => closeCard(true));
        card.addEventListener('click', event => event.stopPropagation());
        fillCard(light);

        // карточка рядом с маркером, но в пределах экрана
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        let left = light.x + 22;
        if (left + cw > W - 12) left = light.x - cw - 22;
        left = Math.max(12, Math.min(left, W - cw - 12));
        let top = light.y - ch / 2;
        top = Math.max(76, Math.min(top, H - ch - 12));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        light.btn.setAttribute('aria-expanded', 'true');
        light.btn.classList.add('is-open');
        card.querySelector('.tl-close').focus({ preventScroll: true });
    }

    function closeCard(returnFocus) {
        if (card) card.remove();
        card = null;
        if (openLight) {
            openLight.btn.setAttribute('aria-expanded', 'false');
            openLight.btn.classList.remove('is-open');
            if (returnFocus) openLight.btn.focus({ preventScroll: true });
        }
        openLight = null;
    }

    document.addEventListener('click', () => { if (openLight) closeCard(); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && openLight) closeCard(true);
    });

    if (speedInput) {
        const applySpeed = () => {
            const sp = SPEEDS[Number(speedInput.value)] || SPEEDS[2];
            simSpeed = sp.m;
            if (speedNote) speedNote.textContent = sp.label;
            speedInput.setAttribute('aria-valuetext', sp.label);
        };
        speedInput.addEventListener('input', applySpeed);
        applySpeed();
        if (reduceMotion) speedInput.closest('.sim-speed').hidden = true;
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

// имя в шапке прячется при прокрутке
(() => { const t = () => document.body.classList.toggle('is-scrolled', window.scrollY > 40); window.addEventListener('scroll', t, { passive: true }); t(); })();

// ===== Подложка ГИС под светлыми разделами =====
// Сетка и контуры улиц, как на подложке карты. Почти прозрачные, под текстом бледнее.
// Лёгкий параллакс при прокрутке; при «уменьшить движение» — статично.
(() => {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const PARALLAX = 0.12;

    const layer = document.createElement('div');
    layer.className = 'gis-bg';
    layer.setAttribute('aria-hidden', 'true');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    layer.appendChild(svg);
    document.body.prepend(layer);

    let seed = 7;
    const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };

    function build() {
        seed = 7;
        const W = window.innerWidth;
        // запас по высоте под параллакс по всей странице
        const H = Math.ceil(window.innerHeight + document.documentElement.scrollHeight * PARALLAX + 200);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.innerHTML = '';

        const path = (d, cls) => {
            const p = document.createElementNS(svgNS, 'path');
            p.setAttribute('d', d);
            p.setAttribute('class', cls);
            svg.appendChild(p);
        };

        // крупные «улицы»: плавные кривые поперёк экрана
        const step = 260;
        for (let y = 80; y < H; y += step * (0.7 + rand() * 0.6)) {
            const a = (rand() - 0.5) * 0.3;
            const freq = 220 + rand() * 120;
            const ph = rand() * 6;
            let d = '';
            for (let x = -40; x <= W + 40; x += 16) {
                const yy = y + x * a + Math.sin(x / freq + ph) * 22;
                d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + yy.toFixed(1);
            }
            path(d, 'gis-road');
        }
        // «проспекты» сверху вниз
        for (let x = 60; x < W; x += 320 + rand() * 260) {
            let d = '';
            const b = (rand() - 0.5) * 0.25;
            for (let y = -40; y <= H + 40; y += 16) {
                const xx = x + y * b + Math.sin(y / 260 + x) * 24;
                d += (d ? ' L' : 'M') + xx.toFixed(1) + ' ' + y.toFixed(1);
            }
            path(d, 'gis-road gis-road-main');
        }
        // мелкие кварталы
        let small = '';
        const count = Math.round((W * H) / 9000);
        for (let i = 0; i < count; i++) {
            const x = rand() * W;
            const y = rand() * H;
            const len = 12 + rand() * 36;
            const horiz = rand() < 0.5;
            small += `M${x.toFixed(0)} ${y.toFixed(0)} l${horiz ? len.toFixed(0) : 0} ${horiz ? 0 : len.toFixed(0)}`;
        }
        path(small, 'gis-street');
        // отметки-крестики в узлах сетки
        let ticks = '';
        for (let y = 96; y < H; y += 192) {
            for (let x = 96; x < W; x += 192) {
                if (rand() < 0.35) ticks += `M${x - 5} ${y} h10 M${x} ${y - 5} v10`;
            }
        }
        path(ticks, 'gis-tick');
    }

    let ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const y = window.scrollY;
            // до конца первого экрана подложку не видно, двигаем мягко
            layer.style.transform = `translate3d(0, ${(-y * PARALLAX).toFixed(1)}px, 0)`;
            ticking = false;
        });
    }

    build();
    if (!reduceMotion) {
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }
    let t;
    window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(build, 200);
    });
    window.addEventListener('load', build);
})();


// ===== Юзабилити: вся карточка проекта нажимается =====
(() => {
    document.querySelectorAll('.folder').forEach(card => {
        const link = card.querySelector('.folder-link');
        if (!link) return;
        card.classList.add('is-clickable');
        card.addEventListener('click', e => {
            if (e.target.closest('a, button')) return;
            if (String(window.getSelection())) return;
            link.click();
        });
    });
})();

// ===== Шапка с подложкой после первого экрана =====
(() => {
    const hero = document.querySelector('.hero');
    const t = () => {
        const edge = hero ? hero.offsetHeight - 70 : 40;
        document.body.classList.toggle('bar-solid', window.scrollY > edge);
    };
    window.addEventListener('scroll', t, { passive: true });
    window.addEventListener('resize', t);
    t();
})();

// ===== Текущий раздел в меню =====
(() => {
    const links = [...document.querySelectorAll('.menu-panel a[href^="#"]')];
    const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
    const sections = [...map.keys()].map(id => document.getElementById(id)).filter(Boolean);
    if (!sections.length) return;
    const t = () => {
        const y = window.scrollY + window.innerHeight * 0.35;
        let cur = null;
        sections.forEach(s => { if (s.offsetTop <= y) cur = s.id; });
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = sections[sections.length - 1].id;
        links.forEach(a => a.classList.toggle('is-active', map.get(cur) === a));
    };
    window.addEventListener('scroll', t, { passive: true });
    t();
})();
