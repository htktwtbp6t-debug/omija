// 화면 공통 도구

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 재료 4종 (순서 고정). 11/3 사과즙 뺌
export const ING = [
  { k: 'omija', name: '오미자 추출액', short: '오미자', color: 'var(--i-omija)', hex: '#D9264A' },
  { k: 'pear', name: '배즙', short: '배즙', color: 'var(--i-pear)', hex: '#C8DC8A' },
  { k: 'syrup', name: '설탕 시럽', short: '시럽', color: 'var(--i-syrup)', hex: '#F4E7C6' },
  { k: 'water', name: '정수', short: '정수', color: 'var(--i-water)', hex: '#9CD2EA' },
];
export const TOTAL = 20; // 레시피는 1인분 20 mL 기준. 큰 컵에는 인원수만큼 곱해서 만든다
export const BASE_ROUNDS = 2; // 모둠 레시피 기본 2번, 시간이 남으면 3번까지
export const MAX_ROUNDS = 3;

// 모둠당 준비물 (n = 모둠 인원)
export const SUPPLIES = (n) => [
  { k: 'cups', name: '플라스틱 컵', qty: '5개', note: '오미자·배즙·설탕 시럽·정수 담을 컵 4 + 제작용 큰 컵 1', ic: 'big' },
  { k: 'syr', name: '주사기', qty: '4개', note: '재료마다 하나씩 따로', ic: 'syringe' },
  { k: 'paper', name: '시음 컵', qty: n ? `${n}개` : '1인 1개', note: n ? '한 사람에 하나' : '모둠 인원수만큼', ic: 'paper' },
  { k: 'stick', name: '커피스틱', qty: n ? `${n}개` : '1인 1개', note: n ? '한 사람에 하나 (젓기)' : '모둠 인원수만큼 (젓기)', ic: 'stick' },
  { k: 'towel', name: '키친타올', qty: '조금', note: '흘린 것 닦기', ic: 'towel' },
];

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

// ---------- 간단한 그림 (안내용 SVG) ----------
// illo(['cup:#D9264A:오미자', '>', 'syringe', '>', 'big:인원수만큼']) 처럼 쓴다. '>'는 화살표
const INK = '#1B1B1B';
const SW = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const PART = {
  cup: (c = '#D9264A') => `<path d="M14 26 L66 26 L60 92 L20 92 Z" fill="#fff" ${SW}/><path d="M17.5 56 L62.5 56 L60 92 L20 92 Z" fill="${c}"/><path d="M14 26 L66 26 L60 92 L20 92 Z" fill="none" ${SW}/>`,
  big: (c = '#D9264A') => `<path d="M4 16 L76 16 L68 96 L12 96 Z" fill="#fff" ${SW}/><path d="M7.4 48 L72.6 48 L68 96 L12 96 Z" fill="${c}" opacity=".9"/><path d="M4 16 L76 16 L68 96 L12 96 Z" fill="none" ${SW}/><path d="M18 40 h44" stroke="${INK}" stroke-width="2" stroke-dasharray="4 4"/>`,
  paper: (c = '#D9264A') => `<path d="M24 44 L56 44 L52 94 L28 94 Z" fill="#fff" ${SW}/><path d="M25.5 62 L54.5 62 L52 94 L28 94 Z" fill="${c}" opacity=".9"/><path d="M24 44 L56 44 L52 94 L28 94 Z" fill="none" ${SW}/><path d="M25 52 h30" stroke="#6EA4F2" stroke-width="3"/>`,
  papers: (c = '#D9264A') => [0, 1, 2].map((i) => `<g transform="translate(${i * 24 - 24} ${i % 2 ? 4 : 0}) scale(.75) translate(13 30)"><path d="M24 44 L56 44 L52 94 L28 94 Z" fill="#fff" ${SW}/><path d="M25.5 62 L54.5 62 L52 94 L28 94 Z" fill="${c}" opacity=".9"/><path d="M24 44 L56 44 L52 94 L28 94 Z" fill="none" ${SW}/></g>`).join(''),
  syringe: (c = '#D9264A') => `<g transform="rotate(-25 40 55)"><rect x="30" y="20" width="20" height="56" rx="3" fill="#fff" ${SW}/><rect x="31.5" y="52" width="17" height="22.5" fill="${c}"/><rect x="30" y="20" width="20" height="56" rx="3" fill="none" ${SW}/><path d="M34 30h6M34 40h6M34 50h6M34 60h6" stroke="${INK}" stroke-width="2"/><path d="M40 20 V6 M30 6 H50" ${SW} fill="none"/><path d="M40 76 V94" ${SW}/></g>`,
  stick: () => `<g transform="rotate(20 40 55)"><rect x="35" y="8" width="10" height="90" rx="5" fill="#E2B985" ${SW}/></g>`,
  towel: () => `<rect x="14" y="30" width="52" height="56" rx="6" fill="#fff" ${SW}/><ellipse cx="40" cy="30" rx="26" ry="9" fill="#fff" ${SW}/><ellipse cx="40" cy="30" rx="7" ry="3" fill="${INK}"/><path d="M22 50 h36 M22 64 h36" stroke="#9CD2EA" stroke-width="3"/>`,
  phone: () => `<rect x="20" y="10" width="40" height="82" rx="8" fill="#fff" ${SW}/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${27 + i * 5.6}" y="${70 - i * 8}" width="4" height="${12 + i * 8}" fill="${['#F6C945', '#3FCB98', '#B79CF0', '#6EA4F2', '#EE3D5B'][i]}"/>`).join('')}<path d="M34 18 h12" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  talk: () => `<path d="M8 22 h44 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-26 l-10 10 v-10 h-8 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6z" fill="#FFF4D6" ${SW}/><path d="M30 50 h38 a6 6 0 0 1 6 6 v18 a6 6 0 0 1 -6 6 h-6 v10 l-10 -10 h-22 a6 6 0 0 1 -6 -6 v-18 a6 6 0 0 1 6 -6z" fill="#E7F8F0" ${SW}/><circle cx="44" cy="65" r="2.5" fill="${INK}"/><circle cx="53" cy="65" r="2.5" fill="${INK}"/><circle cx="62" cy="65" r="2.5" fill="${INK}"/>`,
  taste: () => `<circle cx="40" cy="56" r="32" fill="#F6C945" ${SW}/><circle cx="29" cy="48" r="3.5" fill="${INK}"/><circle cx="51" cy="48" r="3.5" fill="${INK}"/><path d="M26 62 q14 14 28 0" fill="none" ${SW}/><path d="M42 70 q6 10 12 0" fill="#EE3D5B" ${SW}/>`,
  pad: () => `<rect x="6" y="18" width="68" height="74" rx="8" fill="#fff" ${SW}/><path d="M16 36 h20 M16 50 h30 M16 64 h24 M16 78 h28" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M52 34 l5 5 9 -10" fill="none" stroke="#3FCB98" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  four: () => ING.map((i, n) => `<g transform="translate(${(n % 2) * 36 - 2} ${Math.floor(n / 2) * 44 - 16}) scale(.55)"><path d="M14 26 L66 26 L60 92 L20 92 Z" fill="#fff" ${SW}/><path d="M17.5 56 L62.5 56 L60 92 L20 92 Z" fill="${i.hex}"/><path d="M14 26 L66 26 L60 92 L20 92 Z" fill="none" ${SW}/></g>`).join(''),
};
export function illo(items, cls = '') {
  let x = 0;
  const parts = items.map((it) => {
    if (it === '>') {
      const g = `<path transform="translate(${x} 0)" d="M6 56 h22 m-8 -8 l8 8 -8 8" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      x += 34;
      return g;
    }
    const [k, a, label] = it.split(':');
    const lab = label ?? (PART[k] && !a?.startsWith('#') ? a : '');
    const g = `<g transform="translate(${x} 0)">${PART[k](a?.startsWith('#') ? a : undefined)}${lab ? `<text x="40" y="118" text-anchor="middle" font-size="13" font-weight="800" fill="${INK}">${esc(lab)}</text>` : ''}</g>`;
    x += 80;
    return g;
  }).join('');
  return `<svg class="illo ${cls}" viewBox="0 0 ${x} 124" role="img" aria-hidden="true">${parts}</svg>`;
}
