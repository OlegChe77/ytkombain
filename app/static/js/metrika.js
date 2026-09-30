/* Яндекс Метрика и уведомление о cookies.
   Счётчик загружается только после согласия посетителя и только на боевом домене —
   локальные запуски и тесты в статистику не попадают. Код вынесен в файл,
   потому что политика безопасности сайта (CSP) запрещает встроенные скрипты. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;
  var id = Number(me.dataset.id);
  if (!id || location.host !== me.dataset.host) return;
  var KEY = 'kombain-cookies';

  function load() {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + id, 'ym');
    window.ym(id, 'init', {
      ssr: true, webvisor: true, clickmap: true, accurateTrackBounce: true, trackLinks: true,
      referrer: document.referrer, url: location.href
    });
  }

  // Цели Метрики (тип «JavaScript-событие»): инструменты вызывают window.kombainGoal('download_video') и т. п.
  window.kombainGoal = function (name, params) {
    try { if (window.ym) window.ym(id, 'reachGoal', name, params); } catch (e) { /* статистика не должна ломать сайт */ }
  };

  var choice = null;
  try { choice = localStorage.getItem(KEY); } catch (e) { /* без хранилища просто спросим */ }
  if (choice === 'yes') { load(); return; }
  if (choice === 'no') return;

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* ничего */ }
  }

  function show() {
    var bar = document.createElement('div');
    bar.className = 'cookie-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Уведомление о cookies');
    bar.innerHTML = '<p>Мы используем cookies и Яндекс Метрику, чтобы понимать, какие инструменты нужнее. ' +
      'Ваши ссылки и файлы при этом никуда не передаются. <a href="/privacy">Подробнее</a></p>' +
      '<div class="cookie-actions"><button type="button" class="btn btn-primary btn-sm" data-choice="yes">Принять</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-choice="no">Отказаться</button></div>';
    bar.addEventListener('click', function (event) {
      var button = event.target.closest('[data-choice]');
      if (!button) return;
      remember(button.dataset.choice);
      if (button.dataset.choice === 'yes') load();
      bar.remove();
    });
    document.body.appendChild(bar);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
