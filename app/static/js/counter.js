/* Счётчик посещений в подвале (hits.sh — без cookies и регистрации).
   Картинка загружается только на боевом домене, чтобы локальные запуски и тесты не накручивали цифры. */
(function () {
  'use strict';
  var box = document.getElementById('counter');
  if (!box || location.host !== box.dataset.host) return;
  var img = new Image();
  img.src = box.dataset.src;
  img.alt = 'Посещений сегодня / всего';
  img.width = 150;
  img.height = 20;
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onload = function () { box.hidden = false; };
  box.appendChild(img);
})();
