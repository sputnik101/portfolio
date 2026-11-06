// Подсветка активного пункта меню при скролле
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.main-nav a');

window.addEventListener('scroll', () => {
    let current = '';

    sections.forEach(section => {
        const sectionTop = section.offsetTop - 100;
        if (window.scrollY >= sectionTop) {
            current = section.getAttribute('id');
        }
    });

    // Если доскроллили до конца страницы — включаем последнюю секцию
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 10) {
        current = sections[sections.length - 1].getAttribute('id');
    }

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('active');
        }
    });
});