const viewNames = { overview: '概览', opportunity: '商品评估', content: '内容', store: '店铺' };

function showView(name, focus = true) {
  if (!viewNames[name]) return;
  Object.keys(viewNames).forEach(key => {
    document.getElementById('view-' + key).hidden = key !== name;
    const nav = document.querySelector('[data-view="' + key + '"]');
    if (key === name) nav.setAttribute('aria-current', 'page');
    else nav.removeAttribute('aria-current');
  });
  document.getElementById('breadcrumb').textContent = viewNames[name];
  if (focus) {
    document.getElementById('title-' + name).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
document.getElementById('theme').addEventListener('click', event => {
  const dark = document.body.classList.toggle('dark');
  event.currentTarget.textContent = dark ? '浅色外观' : '深色外观';
  event.currentTarget.setAttribute('aria-pressed', String(dark));
});

const money = cents => (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
document.getElementById('cac').addEventListener('input', event => {
  const cac = Math.round(Number(event.target.value) * 100);
  const profit = 2990 - 620 - 560 - 150 - 100 - 60 - cac;
  document.getElementById('cac-value').textContent = money(cac);
  document.getElementById('profit').textContent = money(profit);
  document.getElementById('table-profit').textContent = money(profit);
  document.getElementById('margin').textContent = (profit / 2990 * 100).toFixed(1) + '%';
  document.getElementById('profit-card').classList.toggle('loss', profit < 0);
  document.getElementById('profit-status').textContent = profit > 0
    ? '情景估算，实际供货和运费尚待核实。'
    : profit === 0 ? '当前情景贡献为零，尚未覆盖固定运营成本。' : '当前情景出现亏损，需要重新评估成本。';
});

function setReview(approved) {
  document.getElementById('review-status').textContent = approved ? '已审阅 · 演示' : '待审阅';
  document.getElementById('review-status').classList.toggle('warning', !approved);
  document.getElementById('approve').disabled = approved;
  document.getElementById('reset-review').disabled = !approved;
  document.getElementById('review-note').hidden = !approved;
  document.getElementById('review-total').textContent = approved ? '1' : '2';
  document.getElementById('content-task-status').textContent = approved ? '已审阅' : '待审阅';
}
document.getElementById('approve').addEventListener('click', () => setReview(true));
document.getElementById('reset-review').addEventListener('click', () => setReview(false));
document.getElementById('checkout').addEventListener('click', () => document.getElementById('checkout-dialog').showModal());
