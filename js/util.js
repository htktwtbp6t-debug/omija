// 화면 공통 도구

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 재료 5종 (순서 고정)
export const ING = [
  { k: 'omija', name: '오미자 추출액', short: '오미자', color: 'var(--i-omija)' },
  { k: 'syrup', name: '설탕 시럽', short: '시럽', color: 'var(--i-syrup)' },
  { k: 'apple', name: '사과즙', short: '사과즙', color: 'var(--i-apple)' },
  { k: 'pear', name: '배즙', short: '배즙', color: 'var(--i-pear)' },
  { k: 'water', name: '정수', short: '정수', color: 'var(--i-water)' },
];
export const TOTAL = 20;
export const MAX_ROUNDS = 3;

// 맛 평가 5문항
export const Q = [
  { k: 'sweet', name: '단맛', lo: '약함', hi: '강함', c: 'var(--g2)' },
  { k: 'sour', name: '신맛', lo: '약함', hi: '강함', c: 'var(--g3)' },
  { k: 'aroma', name: '향', lo: '별로', hi: '좋음', c: 'var(--g5)' },
  { k: 'color', name: '색', lo: '별로', hi: '좋음', c: 'var(--g4)' },
  { k: 'overall', name: '종합 맛', lo: '별로', hi: '최고', c: 'var(--g1)' },
];

export const gColor = (g) => `var(--g${g})`;
export const emptyRecipe = () => Object.fromEntries(ING.map((i) => [i.k, 0]));
export const sumRecipe = (r) => ING.reduce((s, i) => s + (Number(r?.[i.k]) || 0), 0);
export const recipeOf = (round) => round?.actual || round?.plan || null;

// 1301 → "1-3"
export const classOf = (stu) => `${stu[0]}-${stu[1]}`;
export const classLabel = (cid) => `${cid.split('-')[0]}학년 ${cid.split('-')[1]}반`;

// 이름은 이 브라우저(localStorage)에만 저장한다
const NAMES_KEY = 'omija-names';
export function loadNames() {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) || '{}'); } catch { return {}; }
}
export function saveNames(map) {
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(map)); } catch { /* 저장 못 해도 진행 */ }
}

export function randomId(n = 20) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(n));
  return [...buf].map((b) => abc[b % abc.length]).join('');
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 같은 seed면 항상 같은 순서 (소믈리에별 시음 순서)
export function seededShuffle(arr, seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function avg(list) {
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;
}
export const fmt1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// 확인 창 (window.confirm 대신, 폰에서도 크게)
export function ask(message, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-box"><p>${message}</p><div class="modal-btns">
      ${cancel ? `<button class="btn ghost" data-v="0">${esc(cancel)}</button>` : ''}
      <button class="btn ${danger ? '' : 'ink'}" data-v="1">${esc(ok)}</button></div></div>`;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      wrap.remove();
      resolve(b.dataset.v === '1');
    });
    document.body.append(wrap);
  });
}

// QR (qrcode-generator 전역 qrcode 사용)
export function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// 눈금 실린더 HTML (레시피 → 층)
export function cylinder(recipe, cls = '') {
  const total = TOTAL;
  const layers = ING.map((i) => {
    const v = Number(recipe?.[i.k]) || 0;
    return v > 0 ? `<i style="flex-basis:${(v / total) * 100}%;background:${i.color}"></i>` : '';
  }).join('');
  return `<div class="cyl ${cls}">${layers}<div class="ticks"></div></div>`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function stuName(stu, names) {
  const n = names?.[stu];
  return n ? `${stu} ${n}` : stu;
}
