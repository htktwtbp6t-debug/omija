// 학생 화면 (모둠장 패드·소믈리에 포함)
import {
  db, studentSignIn, doc, collection, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp,
} from './fb.js';
import {
  $, esc, ING, Q, TOTAL, MAX_ROUNDS, BASE_ROUNDS, SUPPLIES, gColor, emptyRecipe, sumRecipe, recipeOf, cylinder, illo,
  seededShuffle, fmt1, toast, ask, debounce, slideIdx,
} from './util.js';

const main = $('#main');
const sid = new URLSearchParams(location.search).get('s');

const st = {
  uid: null, stu: null, sess: null, claims: new Map(), claimsReady: false, forcePick: false,
  g: null, gdoc: null, summ: null,
  myRating: null, ratingKey: null, taste: null,
  // 화면 안에서만 쓰는 임시 값
  draft: {}, proxy: null, plan: null, planKey: null, tasteDraft: null, tasteCur: null,
};
const unsub = {};

function view(html, key) {
  main.innerHTML = html;
  main.dataset.view = key || '';
}

// ---------- 시작 ----------
async function start() {
  if (!sid) {
    view(`<div class="center"><div><h2>QR 코드로<br>들어와 주세요</h2><p class="hint">선생님 화면의 QR을 카메라로 찍으면 열려요.</p></div></div>`);
    return;
  }
  try {
    const u = await studentSignIn();
    if (!u) {
      view(`<div class="center"><div><h2>선생님 계정으로<br>로그인된 브라우저예요</h2><p class="hint">학생 화면은 학생 기기나 시크릿 창에서 열어 주세요.</p></div></div>`);
      return;
    }
    st.uid = u.uid;
    await u.getIdToken(); // 로그인 직후 권한 확인이 늦어 첫 읽기가 거절되는 일을 막는다
  } catch (e) {
    console.error(e);
    view(`<div class="center"><div><h2>접속 오류</h2><p class="hint">와이파이를 확인하고 새로고침해 주세요.</p></div></div>`);
    return;
  }
  connecting();
  watchCore();
}

// 접속 직후에는 '수업 없음'·권한 오류가 잠깐 났다가 풀리는 경우가 있어,
// 바로 오류를 띄우지 않고 '연결 중'으로 다시 시도한다. 30초 넘게 안 되면 그때 안내한다.
const RETRY_MS = 3000, RETRY_MAX = 10;
let retries = 0, retryTimer = null;
function watchCore() {
  unsub.dev?.(); unsub.sess?.(); unsub.claims?.();
  // 서버 확인 전(캐시만 본 상태)에는 '없음'으로 판단하지 않고 연결 중으로 기다린다
  const meta = { includeMetadataChanges: true };
  unsub.dev = onSnapshot(doc(db, 'sessions', sid, 'devices', st.uid), meta, (d) => {
    // 학번 저장이 서버에 닿기 전에 모둠을 구독하면 권한 거절로 끝나 화면이 멈춘다 (수업 도중 입장)
    if (d.metadata.hasPendingWrites) return;
    if (d.exists()) { st.stu = d.data().stu; st.devReady = true; }
    else if (!d.metadata.fromCache) st.devReady = true;
    if (st.devReady) { syncGroup(); render(); }
  }, (e) => retryCore('device', e));

  unsub.sess = onSnapshot(doc(db, 'sessions', sid), meta, (s) => {
    if (!s.exists()) {
      if (s.metadata.fromCache) return connecting();
      return retryCore('missing');
    }
    retries = 0; clearTimeout(retryTimer); retryTimer = null;
    st.sess = s.data();
    syncGroup();
    render();
  }, (e) => retryCore('session', e));
  unsub.claims = onSnapshot(collection(db, 'sessions', sid, 'claims'), (qs) => {
    st.claims = new Map(qs.docs.map((d) => [d.id, d.data().uid]));
    st.claimsReady = true;
    render();
  }, (e) => retryCore('claims', e));
}

function retryCore(what, e) {
  if (e) console.error(what, e);
  if (retryTimer) return;
  if (retries >= RETRY_MAX) {
    const code = e?.code || what;
    view(`<div class="center"><div><h2>수업에 연결하지 못했어요</h2>
      <p class="hint">와이파이를 확인하고 다시 시도해 주세요.<br>계속 안 되면 QR을 다시 찍어 주세요.</p>
      <p style="margin-top:16px"><button class="btn" id="retry">다시 시도</button></p>
      <p class="hint" style="font-size:12px;margin-top:10px">(${esc(code)})</p></div></div>`);
    $('#retry').onclick = () => location.reload();
    return;
  }
  st.sess = null;
  connecting();
  retryTimer = setTimeout(() => { retryTimer = null; retries += 1; watchCore(); }, RETRY_MS);
}

let slowTimer;
function connecting() {
  if (main.dataset.view === 'connecting') return;
  view(`<div class="center"><div><span class="spin"></span><h2 style="margin-top:14px">연결하는 중…</h2>
    <p class="hint" id="slow" hidden>오래 걸리면 와이파이를 확인하고 새로고침해 주세요.</p></div></div>`, 'connecting');
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { const el = $('#slow'); if (el) el.hidden = false; }, 8000);
}

// 내 모둠이 정해지면 모둠 문서·평균 구독
function syncGroup(force) {
  const s = st.sess;
  let g = null;
  if (st.stu && s?.groupsConfirmed && s.groups) {
    for (const [k, v] of Object.entries(s.groups)) if (v.members?.includes(st.stu)) g = k;
  }
  const same = g === st.g;
  if (same && !force) return;
  st.g = g;
  unsub.g?.(); unsub.summ?.();
  if (!same) { st.gdoc = null; st.summ = null; }
  if (!g) return;
  // 권한이 잠깐 거절되면 다시 구독한다. 학번이 다른 기기로 옮겨졌으면 다시 고를 때 pick()이 구독한다
  const retry = () => {
    clearTimeout(st.gRetry);
    st.gRetry = setTimeout(() => { if (st.claims.get(st.stu) === st.uid) syncGroup(true); }, 3000);
  };
  unsub.g = onSnapshot(doc(db, 'sessions', sid, 'groups', g), (d) => {
    st.gdoc = d.exists() ? d.data() : null;
    syncRating();
    render();
  }, retry);
  unsub.summ = onSnapshot(doc(db, 'sessions', sid, 'summaries', g), (d) => {
    st.summ = d.exists() ? d.data() : null;
    render();
  }, retry);
}

// 이번 회차 내 평가 구독
function syncRating() {
  const r = st.gdoc?.round;
  const key = r ? `${r}_${st.stu}` : null;
  if (key === st.ratingKey) return;
  st.ratingKey = key;
  unsub.rating?.();
  st.myRating = null;
  st.draft = {};
  if (!key) return;
  unsub.rating = onSnapshot(doc(db, 'sessions', sid, 'ratings', key), (d) => {
    st.myRating = d.exists() ? d.data() : null;
    render();
  }, () => {});
}

// 소믈리에 후보: 결석생 뺀 모둠원
function candidates() {
  const absent = new Set(st.sess.absent || []);
  return members().filter((m) => !absent.has(m));
}

function syncTaste(on) {
  if (on && !unsub.taste) {
    unsub.taste = onSnapshot(doc(db, 'sessions', sid, 'tastes', st.stu), (d) => {
      st.taste = d.exists() ? d.data() : null;
      render();
    }, () => {});
  }
}

// ---------- 화면 고르기 ----------
function render() {
  const s = st.sess;
  if (!s || !st.devReady) return;
  // 글을 쓰는 중이면 다시 그리지 않음 (키보드가 닫히지 않게)
  const act = document.activeElement;
  if (act && main.contains(act) && act.matches('textarea,input')) return;

  // 다른 기기가 같은 학번을 골랐으면 이 기기는 학번 고르기로 돌아간다
  const lost = st.stu && st.claimsReady && st.claims.get(st.stu) !== st.uid;
  if (!st.stu || lost || st.forcePick) return s.open ? renderPick(lost) : view(closedHtml());
  if (!s.open) return view(closedHtml());
  if (!st.g) return renderWaitGroup();

  const stage = s.stage;
  if (['intro', 'join', 'grouping', 'brief'].includes(stage)) return renderMyGroup();
  if (stage === 'develop') return renderDevelop();
  if (stage === 'tasting') return renderTasting();
  if (stage === 'reveal') return renderReveal();
  return view(closedHtml());
}

function leader() {
  return st.sess.groups?.[st.g]?.leader;
}
function isLeader() {
  return leader() === st.stu;
}
function members() {
  return st.sess.groups?.[st.g]?.members || [];
}

function topBar(right = '') {
  const role = isLeader() ? '모둠장' : '';
  return `<div class="top"><span class="who">${st.g ? `<span class="gchip" style="--c:${gColor(st.g)}">${st.g}</span>` : ''}
    <span class="num">${esc(st.stu)}</span>${role ? `<span class="pill light">${role}</span>` : ''}</span>${right}</div>`;
}

function closedHtml() {
  return `${st.stu ? topBar() : ''}<div class="wait grow"><div class="big">수고했어요!</div>
    <p class="hint">다음 차시: 맛있는 음료는 <b>얼마나 달고 얼마나 신지</b><br>숫자로 재 봐요.</p></div>`;
}

// ---------- 학번 고르기 ----------
// 잠금 없음: 이미 접속한 학번도 고를 수 있고, 그러면 그 학번은 이 기기로 옮겨진다
function renderPick(lost) {
  const s = st.sess;
  const absent = new Set(s.absent || []);
  const btns = s.roster.map((n) => {
    const on = st.claims.has(n) && st.claims.get(n) !== st.uid;
    return `<button data-stu="${esc(n)}" class="${on ? 'taken' : ''}" ${absent.has(n) ? 'disabled' : ''}>${esc(n)}</button>`;
  }).join('');
  view(`${lost ? '<div class="note y" style="margin-bottom:12px">다른 기기에서 이 학번으로 접속했어요. 내 학번을 다시 골라 주세요.</div>' : ''}
    <h2>내 학번을<br><span class="hl">골라요</span></h2>
    <p class="hint">점선 = 이미 접속한 학번이에요. 기기를 바꿨다면 내 학번을 그대로 누르면 돼요.</p>
    <div class="picker">${btns}</div>
    ${st.forcePick && !lost ? '<button class="btn ghost sm" id="cancelpick" style="margin-top:12px">취소</button>' : ''}`, 'pick');
  main.querySelectorAll('[data-stu]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.stu)));
  $('#cancelpick')?.addEventListener('click', () => { st.forcePick = false; render(); });
}

async function pick(stu) {
  const other = st.claims.has(stu) && st.claims.get(stu) !== st.uid;
  const ok = await ask(`<b class="num" style="font-size:2rem">${esc(stu)}</b><br>내 학번이 맞나요?${other ? '<br><span style="font-size:.9rem">다른 기기에서 접속 중이에요. 이 기기로 옮겨요.</span>' : ''}`, { ok: '맞아요', cancel: '다시 고를래요' });
  if (!ok) return;
  const b = writeBatch(db);
  const old = st.stu;
  if (old && old !== stu && st.claims.get(old) === st.uid) b.delete(doc(db, 'sessions', sid, 'claims', old));
  b.set(doc(db, 'sessions', sid, 'claims', stu), { uid: st.uid, at: serverTimestamp() });
  b.set(doc(db, 'sessions', sid, 'devices', st.uid), { stu, at: serverTimestamp() });
  try {
    await b.commit();
    st.stu = stu;
    st.forcePick = false;
    st.claims.set(stu, st.uid);
    syncGroup(true);
    render();
  } catch (e) {
    console.error(e);
    await ask('이 학번은 고를 수 없어요.<br>선생님께 말해 주세요.', { ok: '알겠어요', cancel: '' });
  }
}
function changeBtn() {
  return '<button class="btn ghost sm" id="chstu" style="margin-top:14px">학번을 잘못 골랐어요</button>';
}
function bindChange() {
  $('#chstu')?.addEventListener('click', () => { st.forcePick = true; render(); });
}

// ---------- 모둠 배치 전후 ----------
function renderWaitGroup() {
  view(`${topBar()}<div class="wait grow">
    <span class="spin"></span>
    <div class="big">모둠 배치를<br>기다리는 중</div>
    <p class="hint">TV 화면을 봐 주세요.</p>${changeBtn()}</div>`, 'waitg');
  bindChange();
}

function supplyList(n) {
  return `<div class="sups">${SUPPLIES(n).map((x) => `<div class="sp">${illo([`${x.ic}::`])}<span><b>${x.name} <span class="hl">${x.qty}</span></b><small>${x.note}</small></span></div>`).join('')}</div>`;
}

function renderMyGroup() {
  const L = isLeader();
  const showSup = st.sess.groupsConfirmed && (st.sess.slide || 0) >= slideIdx('supplies');
  if (showSup) {
    // 준비물 슬라이드부터: 모둠 표시는 한 줄로 줄이고 준비물을 먼저
    view(`${topBar()}
      <div class="gline" style="--c:${gColor(st.g)}"><span class="gchip">${st.g}</span><b>${st.g}모둠</b><span>모둠장 <span class="num">${esc(leader() || '–')}</span>${L ? ' (나)' : ''}</span></div>
      ${supplyBlock(L)}
      <p class="hint" style="margin-top:12px">우리 모둠: ${members().map((m) => `<span class="num">${esc(m)}</span>`).join(' · ')}</p>
      ${changeBtn()}`, 'mygroup');
    bindChange();
    bindSup(renderMyGroup);
    return;
  }
  const list = members().map((m) => `<div class="m"><span class="num">${esc(m)}${m === st.stu ? ' (나)' : ''}</span>${m === leader() ? '<span class="pill">모둠장</span>' : ''}</div>`).join('');
  view(`${topBar()}
    <div class="mygroup" style="--c:${gColor(st.g)}">
      <span class="gchip bigchip">${st.g}</span>
      <div><div class="big">나는 <span class="hl">${st.g}모둠</span>${L ? '<br>모둠장!' : ''}</div>
        <p class="go">${st.g}모둠 자리로 이동하세요</p></div></div>
    <div class="box flat" style="margin-bottom:12px"><b>모둠장</b> <span class="num" style="font-size:1.3rem;font-weight:800">${esc(leader() || '–')}</span>${L ? ' (나)' : ''}</div>
    <div class="members">${list}</div>
    ${L ? `<div class="note y" style="margin-top:14px">모둠장은 이 화면으로 모둠을 이끌어요. 개발이 시작되면 <b>준비물 체크 → 각자 맛보기 → 레시피 정하기</b> 순서로 화면이 안내해요.</div>` : '<p class="hint" style="margin-top:14px">TV와 모둠장 화면의 안내를 따라와요.</p>'}
    ${changeBtn()}`, 'mygroup');
  bindChange();
}

// 준비물 체크 표시는 모둠장 기기에만 저장 (개발 첫 단계 '준비'와 같은 칸을 씀)
const supKey = () => `omija-sup-${sid}-${st.g}`;
function supChecks() {
  try { return JSON.parse(localStorage.getItem(supKey()) || '{}'); } catch { return {}; }
}
function bindSup(again) {
  main.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => {
    const ck = supChecks();
    ck[b.dataset.sup] = !ck[b.dataset.sup];
    try { localStorage.setItem(supKey(), JSON.stringify(ck)); } catch { /* 무시 */ }
    again();
  }));
}
// 준비물 슬라이드부터: 모둠원은 목록만, 모둠장은 눌러서 체크
function supplyBlock(L) {
  const n = present().length;
  if (!L) {
    return `<h2 class="suph">준비물 <span class="hl">챙기기</span></h2>
      <p class="hint">모둠장과 나눠서 앞에서 받아 와요. <b>체크는 모둠장이 해요.</b></p>${supplyList(n)}`;
  }
  const ck = supChecks();
  const sups = SUPPLIES(n);
  const left = sups.filter((x) => !ck[x.k]).length;
  return `<h2 class="suph">준비물 <span class="hl">체크</span></h2><div class="ckcall ${left ? '' : 'ok'}">${left ? `모둠장! 챙긴 준비물을 <b>눌러서 체크</b>해요 <span class="num">${left}개 남음</span>` : '준비물 체크 끝! ✓'}</div>
    <div class="sups ck">${sups.map((x) => `<button class="sp ${ck[x.k] ? 'on' : ''}" data-sup="${x.k}">${illo([`${x.ic}::`])}<span><b>${x.name} <span class="hl">${x.qty}</span></b><small>${x.note}</small></span><i class="box-ck"></i></button>`).join('')}</div>`;
}

// ---------- ② 개발 ----------
const STEPS = [['prep', '준비'], ['free', '각자'], ['plan', '레시피'], ['make', '만들기'], ['rate', '평가'], ['decide', '결정']];

// 단계 안내: 그림 + 할 일 목록
function guide(art, items, title = '지금 할 일') {
  return `<div class="guide">${art}<div><b>${title}</b><ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol></div></div>`;
}
// 모둠에서 함께 마시는 인원 (결석 제외). 큰 컵에는 이만큼 곱해서 만든다
function present() {
  const absent = new Set(st.sess.absent || []);
  return members().filter((m) => !absent.has(m));
}
function batchN() {
  return st.batchN || Math.max(1, present().length);
}

function stepBar(step) {
  const idx = STEPS.findIndex(([k]) => k === step);
  return `<div class="stepbar">${STEPS.map(([, n], i) => `<div class="${i < idx || step === 'done' ? 'done' : i === idx ? 'now' : ''}">${n}</div>`).join('')}</div>`;
}

function renderDevelop() {
  const gd = st.gdoc;
  if (!gd) return view(`${topBar()}<div class="center"><span class="spin"></span></div>`);
  const r = gd.round;
  const pre = ['prep', 'free'].includes(gd.step);
  const head = `${topBar(pre ? '' : `<span class="pill">시제품 ${Math.min(r, MAX_ROUNDS)}${r <= BASE_ROUNDS ? ` / ${BASE_ROUNDS}` : ' (추가)'}</span>`)}${gd.step === 'done' ? '' : stepBar(gd.step)}`;
  const L = isLeader();
  main.classList.toggle('wide', L);
  if (st.proxy && !(L && gd.step === 'rate')) st.proxy = null;

  switch (gd.step) {
    case 'prep': return prepView(head, L);
    case 'free': return freeView(head, L);
    case 'plan': return L ? leaderPlan(head, gd) : memberPlan(head, gd);
    case 'make': return L ? leaderMake(head, gd) : memberMake(head, gd);
    case 'rate': return L ? leaderRate(head, gd) : memberRate(head, gd);
    case 'decide': return decideView(head, gd, L);
    default: return doneView(head, gd);
  }
}

// 준비물 체크 (모둠장). 체크 표시는 이 기기에만 저장
function prepView(head, L) {
  const n = present().length;
  const ck = supChecks();
  const sups = SUPPLIES(n);
  const all = sups.every((x) => ck[x.k]);
  if (!L) {
    view(`${head}<h2>준비물 <span class="hl">챙기기</span></h2>
      <p class="hint">모둠장과 같이 앞에서 받아 와요. 재료 4가지는 플라스틱 컵에 담아 와요. <b>체크는 모둠장이 해요.</b></p>${supplyList(n)}`, 'mprep');
    return;
  }
  view(`${head}<h2>준비물 <span class="hl">체크</span></h2>
    <p class="hint">모둠원과 나눠서 앞에서 받아 와요. 우리 모둠 ${n}명.</p>
    <div class="ckcall ${all ? 'ok' : ''}">${all ? '준비물 체크 끝! ✓' : `모둠장! 챙긴 준비물을 <b>눌러서 체크</b>해요 <span class="num">${sups.filter((x) => !ck[x.k]).length}개 남음</span>`}</div>
    <div class="sups ck">${sups.map((x) => `<button class="sp ${ck[x.k] ? 'on' : ''}" data-sup="${x.k}">${illo([`${x.ic}::`])}<span><b>${x.name} <span class="hl">${x.qty}</span></b><small>${x.note}</small></span><i class="box-ck"></i></button>`).join('')}</div>
    <div class="note" style="margin:10px 0">재료 컵 4개(오미자·배즙·알룰로스 시럽·정수)에 재료를 받고, <b>큰 컵 하나는 비워 둬요</b>.</div>
    <div class="foot"><button class="btn block" id="go" ${all ? '' : 'disabled'}>${all ? '준비 완료 → 각자 맛보기 시작' : '모두 체크하면 시작할 수 있어요'}</button></div>`, 'prep');
  bindSup(renderDevelop);
  $('#go').addEventListener('click', () => gUpdate({ step: 'free' }));
}

// 각자 자유롭게 만들어 맛보기 (기록 안 함)
function freeView(head, L) {
  view(`${head}<h2>각자 <span class="hl">만들어 맛보기</span></h2>
    ${guide(illo(['four::재료', '>', 'syringe', '>', 'paper::내 컵', '>', 'taste::맛보기']), [
    '<b>내 시음 컵</b>을 하나 가져요.',
    '재료마다 정해진 <b>주사기</b>로 조금씩 넣어 마음대로 섞어요. (다 합쳐 20 mL 정도)',
    '커피스틱으로 젓고 <b>맛봐요</b>. 재료를 바꿔 가며 여러 번 해 봐도 돼요.',
    '어떤 재료가 <b>단맛·신맛·향</b>을 내는지 느껴 보고 모둠원에게 말해 줘요.',
  ])}
    <div class="note y" style="margin:10px 0">이번에는 <b>기록하지 않아요</b>. 다음 단계에서 모둠 레시피를 정할 때 쓸 감을 잡는 시간이에요.<br>시음 컵은 버리지 말고 계속 써요.</div>
    ${L ? '<div class="foot"><button class="btn block" id="go">모두 맛봤어요 → 모둠 레시피 정하기</button></div>' : '<p class="hint">모두 맛보면 모둠장이 다음 단계로 넘겨요.</p>'}`, 'free');
  $('#go')?.addEventListener('click', async () => {
    if (!(await ask('모두 맛봤나요?<br>이제 모둠 레시피 하나를 정해요.', { ok: '레시피 정하기' }))) return;
    st.planKey = null;
    gUpdate({ step: 'plan' });
  });
}

// 레시피 고칠 때 참고 (2번째부터)
const TIPS = '<div class="tips"><b>고치는 팁</b><span>너무 시다 → 오미자 ↓ 또는 알룰로스·배즙 ↑</span><span>너무 달다 → 알룰로스 ↓ 또는 정수 ↑</span><span>맛이 진하다 → 정수 ↑</span><span>밍밍하다 → 정수 ↓</span></div>';

const groupRef = () => doc(db, 'sessions', sid, 'groups', st.g);
async function gUpdate(data) {
  try {
    await updateDoc(groupRef(), { ...data, updatedAt: serverTimestamp() });
  } catch (e) {
    console.error(e);
    toast('저장하지 못했어요. 지금 단계에서는 바꿀 수 없어요.');
  }
}

// 배합 정하기 (모둠장)
const savePlan = debounce((r, plan) => gUpdate({ [`rounds.${r}.plan`]: plan }), 450);

function leaderPlan(head, gd) {
  const r = gd.round;
  const key = `${r}`;
  if (st.planKey !== key) {
    st.planKey = key;
    st.plan = { ...emptyRecipe(), ...(gd.rounds?.[r]?.plan || recipeOf(gd.rounds?.[r - 1]) || {}) };
  }
  const p = st.plan;
  const tot = sumRecipe(p);
  const rows = ING.map((i) => `<div class="ing step-row" style="--c:${i.color}"><span class="sw"></span><span>${i.name}</span>
    <span class="stepper"><button data-k="${i.k}" data-d="-1" aria-label="${i.short} 빼기">−</button><span class="v">${p[i.k]}<small>mL</small></span><button data-k="${i.k}" data-d="1" aria-label="${i.short} 더하기">+</button></span></div>`).join('');
  view(`${head}
    <h2>시제품 ${r}: <span class="hl">모둠 레시피 정하기</span></h2>
    ${r > 1 ? `<div class="prev"><b>시제품 ${r - 1} 결과</b> (모둠 평균)${avgBars(roundSumm(r - 1)?.avg)}</div>${TIPS}` : guide(illo(['talk::의논', '>', 'pad::입력']), [
    '각자 맛본 걸 이야기해서 <b>레시피 하나</b>를 정해요.',
    '<b>한 사람 몫 20 mL</b> 기준으로 −/+를 눌러 입력해요. (큰 컵 양은 다음 화면이 계산해요)',
    '합계가 20 mL가 되면 <b>만들기</b>를 눌러요.',
  ])}
    <p class="hint">${r > 1 ? '직전 레시피에서 시작해요. 무엇을 바꿀지 모둠이 같이 정해요. ' : ''}합계를 20 mL로 맞춰요.</p>
    <div class="plan-wrap"><div class="vis">${cylinder(p, tot > TOTAL ? 'over' : '')}
      <div class="tot ${tot !== TOTAL ? 'bad' : ''}">${tot}<small> / ${TOTAL} mL</small></div></div>
      <div>${rows}</div></div>
    <div class="foot"><button class="btn block" id="go" ${tot === TOTAL ? '' : 'disabled'}>${tot === TOTAL ? '이 배합으로 만들기' : tot < TOTAL ? `${TOTAL - tot} mL 더 넣어야 해요` : `${tot - TOTAL} mL 많아요`}</button></div>`, 'plan');
  main.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    p[k] = Math.max(0, Math.min(TOTAL, p[k] + Number(b.dataset.d)));
    savePlan(r, { ...p });
    renderDevelop();
  }));
  $('#go').addEventListener('click', () => {
    gUpdate({ [`rounds.${r}`]: { plan: { ...p }, actual: { ...p } }, step: 'make' });
  });
}

function recipeRows(rec) {
  return ING.map((i) => `<div class="ing step-row" style="--c:${i.color}"><span class="sw"></span><span>${i.name}</span><span class="v">${rec?.[i.k] ?? 0}<small>mL</small></span></div>`).join('');
}

function memberPlan(head, gd) {
  const p = gd.rounds?.[gd.round]?.plan || emptyRecipe();
  const tot = sumRecipe(p);
  view(`${head}<h2>시제품 ${gd.round}: <span class="hl">모둠 레시피 정하기</span></h2>
    <div class="plan-wrap"><div class="vis">${cylinder(p)}<div class="tot ${tot !== TOTAL ? 'bad' : ''}">${tot}<small> / ${TOTAL} mL</small></div></div>
    <div>${recipeRows(p)}</div></div>
    <p class="note" style="margin-top:12px">모둠장 화면에 <b>같이 정한 레시피</b>를 입력하는 중이에요. 의견을 말해 주세요! (한 사람 몫 20 mL 기준)</p>
    ${gd.round > 1 ? `<div class="prev" style="margin-top:10px"><b>시제품 ${gd.round - 1} 결과</b> (모둠 평균)${avgBars(roundSumm(gd.round - 1)?.avg)}</div>${TIPS}` : ''}`, 'mplan');
}

// 큰 컵에 만들기: 레시피(1인분 20 mL) × 인원수
function batchHead(L) {
  const n = batchN();
  return `<div class="batch"><span>모둠 <b class="num">${n}</b>명 → 큰 컵에 <b>×${n}</b> = <b class="num">${TOTAL * n}</b> mL</span>
    ${L ? '<span class="stepper sm"><button data-n="-1" aria-label="인원 빼기">−</button><button data-n="1" aria-label="인원 더하기">+</button></span>' : ''}</div>`;
}
function bindBatch() {
  main.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
    st.batchN = Math.max(1, Math.min(8, batchN() + Number(b.dataset.n)));
    renderDevelop();
  }));
}
const makeGuide = () => guide(illo(['syringe', '>', 'big::큰 컵', '>', 'stick::젓기', '>', 'papers::나눠 따르기']), [
  '재료마다 <b>그 재료의 주사기</b>로, 오른쪽 <b>넣을 양</b>만큼 큰 컵(제작용)에 넣어요.',
  '다 넣으면 커피스틱으로 <b>잘 저어요</b>.',
  '모둠원 <b>시음 컵에 똑같이 나눠</b> 따라요.',
]);

function leaderMake(head, gd) {
  const r = gd.round;
  const rd = gd.rounds?.[r] || {};
  const plan = rd.plan || emptyRecipe();
  const act = { ...plan, ...(rd.actual || {}) };
  const n = batchN();
  const rows = ING.map((i) => {
    const diff = act[i.k] !== plan[i.k];
    return `<div class="ing mk2 ${diff ? 'diff' : ''}" style="--c:${i.color}"><span class="sw"></span>
      <span>${i.short}<small class="per">1인분 ${act[i.k]} mL${diff ? ` (계획 ${plan[i.k]})` : ''}</small></span>
      <span class="put"><small>넣을 양</small><b class="num">${act[i.k] * n}</b><small>mL</small></span></div>`;
  }).join('');
  view(`${head}<h2>큰 컵에 <span class="hl">만들기</span></h2>
    ${makeGuide()}
    ${batchHead(true)}
    <div>${rows}</div>
    <details class="fix"><summary>계획과 다르게 넣었어요 (1인분 기준으로 고치기)</summary>
      ${ING.map((i) => `<div class="ing step-row" style="--c:${i.color}"><span class="sw"></span><span>${i.short}</span>
        <span class="stepper"><button data-k="${i.k}" data-d="-1">−</button><span class="v">${act[i.k]}<small>mL</small></span><button data-k="${i.k}" data-d="1">+</button></span></div>`).join('')}</details>
    <div class="foot"><button class="btn block" id="go">다 만들었어요 → 각자 평가 시작</button>
      <button class="btn ghost sm" id="back">← 레시피 다시 정하기</button></div>`, 'make');
  const fix = main.querySelector('details.fix');
  if (st.fixOpen === r) fix.open = true; // 회차가 바뀌면 다시 접힌 채로
  fix.addEventListener('toggle', () => { st.fixOpen = fix.open ? r : null; });
  bindBatch();
  main.querySelectorAll('.stepper button[data-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    const v = Math.max(0, Math.min(TOTAL * 2, act[k] + Number(b.dataset.d)));
    gUpdate({ [`rounds.${r}.actual.${k}`]: v });
  }));
  $('#go').addEventListener('click', async () => {
    if (!(await ask('모두의 시음 컵에 나눠 따랐나요?<br>이제 각자 폰으로 평가해요.', { ok: '평가 시작' }))) return;
    gUpdate({ step: 'rate' });
  });
  $('#back').addEventListener('click', () => {
    st.planKey = null;
    gUpdate({ step: 'plan' });
  });
}

function memberMake(head, gd) {
  const rd = gd.rounds?.[gd.round] || {};
  const act = rd.actual || rd.plan || emptyRecipe();
  const n = batchN();
  const rows = ING.map((i) => `<div class="ing mk2" style="--c:${i.color}"><span class="sw"></span>
    <span>${i.short}<small class="per">1인분 ${act[i.k]} mL</small></span>
    <span class="put"><small>넣을 양</small><b class="num">${act[i.k] * n}</b><small>mL</small></span></div>`).join('');
  view(`${head}<h2>같이 <span class="hl">만들어요</span></h2>
    ${makeGuide()}${batchHead(false)}<div>${rows}</div>
    <p class="hint" style="margin-top:10px">다 나눠 따르면 모둠장이 평가를 시작해요. <b>마시고 나서 꼭 이 폰으로 평가!</b></p>`, 'mmake');
}

// 맛 평가 폼
function ratingForm(title, sub, target, proxy) {
  const d = st.draft;
  const left = Q.filter((q) => !d[q.k]).length;
  const qs = Q.map((q) => `<div class="qq" style="--c:${q.c}"><div class="t">${q.name}<b>${d[q.k] || '–'}</b></div>
    <div class="eq" data-q="${q.k}">${[1, 2, 3, 4, 5].map((v) => `<b data-v="${v}" style="height:100%;display:flex;align-items:flex-end"><i class="${d[q.k] >= v ? 'on' : ''}" style="width:100%;height:${[22, 40, 60, 80, 100][v - 1]}%"></i></b>`).join('')}</div>
    <div class="ends"><span>${q.lo}</span><span>${q.hi}</span></div></div>`).join('');
  return `<h2 style="font-size:1.6rem;margin-top:10px">${title}</h2><p class="hint" style="margin-bottom:8px">${sub}</p>${qs}
    <button class="btn block" id="submit" data-target="${esc(target)}" data-isproxy="${proxy ? 1 : 0}" ${left ? 'disabled' : ''}>${left ? `${left}개 남았어요` : '제출하기'}</button>`;
}

function bindRating(after) {
  main.querySelectorAll('.eq[data-q]').forEach((eq) => eq.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    st.draft[eq.dataset.q] = Number(b.dataset.v);
    after();
  }));
  const sb = $('#submit');
  sb?.addEventListener('click', async () => {
    const target = sb.dataset.target;
    const proxy = sb.dataset.isproxy === '1';
    const r = st.gdoc.round;
    sb.disabled = true;
    try {
      await setDoc(doc(db, 'sessions', sid, 'ratings', `${r}_${target}`), {
        g: st.g, r, stu: target, by: st.uid, proxy, ...st.draft, at: serverTimestamp(),
      });
      st.draft = {};
      if (proxy) {
        st.proxy = null;
        toast(`${target} 대리 평가를 저장했어요.`);
      }
      after();
    } catch (e) {
      console.error(e);
      sb.disabled = false;
      toast('저장하지 못했어요. 평가 시간이 끝났을 수 있어요.');
    }
  });
}

function memberRate(head, gd) {
  if (st.myRating && !st.editing) {
    view(`${head}<div class="wait grow"><div class="big">제출 완료!</div>
      <p class="hint">모둠원이 모두 내면 모둠장이 결과를 열어요.<br>결과를 보고 어떻게 고칠지 같이 이야기해요.</p>
      <button class="btn ghost sm" id="edit">점수 고치기</button></div>`, 'mrated');
    $('#edit').addEventListener('click', () => {
      st.editing = true;
      st.draft = Object.fromEntries(Q.map((q) => [q.k, st.myRating[q.k]]));
      renderDevelop();
    });
    return;
  }
  view(`${head}${ratingForm(`시제품 ${gd.round} <span class="hl">내 평가</span>`, '나눠 받은 <b>내 시음 컵</b>을 마셔 보고, 5문항 막대를 눌러 점수를 골라요. 다 고르면 <b>제출</b>!', st.stu, false)}`, 'rate');
  bindRating(() => { if (!Object.keys(st.draft).length) st.editing = false; renderDevelop(); });
}

function roundSumm(r) {
  return st.summ?.rounds?.[r] || null;
}

function leaderRate(head, gd) {
  const r = gd.round;
  const absent = new Set(st.sess.absent || []);
  const done = new Set(roundSumm(r)?.done || []);
  if (st.myRating) done.add(st.stu);
  const present = members().filter((m) => !absent.has(m));
  if (st.proxy) {
    view(`${head}${ratingForm(`<span class="num">${esc(st.proxy)}</span> <span class="hl">대신 평가</span>`, '기기가 없는 모둠원의 점수를 받아 입력해요. "대리"로 표시돼요.', st.proxy, true)}
      <button class="btn ghost sm" id="cancel" style="margin-top:10px">취소</button>`, 'proxy');
    bindRating(renderDevelop);
    $('#cancel').addEventListener('click', () => { st.proxy = null; st.draft = {}; renderDevelop(); });
    return;
  }
  const list = present.map((m) => {
    const isDone = done.has(m);
    const offline = !st.claims.has(m);
    const right = isDone ? '✓ 제출' : offline ? `<button class="btn sm yellow" data-proxy="${esc(m)}">대신 평가</button>` : '<span class="st">평가 중</span>';
    return `<div class="m ${isDone ? 'done' : ''}"><span class="num">${esc(m)}${m === st.stu ? ' (나)' : ''}</span>${right}</div>`;
  }).join('');
  const n = present.filter((m) => done.has(m)).length;
  const mine = st.myRating && !st.editing
    ? '<div class="note g" style="margin:10px 0">내 평가 제출 완료</div>'
    : ratingForm(`시제품 ${r} <span class="hl">맛보기</span>`, '모둠장도 평가해요. 막대를 눌러 점수를 골라요.', st.stu, false);
  view(`${head}<div class="split"><div>${mine}</div>
    <div><h2 style="font-size:1.4rem;margin-top:10px">제출 현황 <span class="num">${n} / ${present.length}</span></h2>
      <p class="hint">기기가 없는 모둠원은 '대신 평가'로 입력해요.</p>
      <div class="members">${list}</div>
      <div class="foot"><button class="btn block ink" id="close">평가 마감 → 결과 보기</button></div></div></div>`, 'lrate');
  bindRating(() => { st.editing = false; renderDevelop(); });
  main.querySelectorAll('[data-proxy]').forEach((b) => b.addEventListener('click', () => {
    st.proxy = b.dataset.proxy;
    st.draft = {};
    renderDevelop();
  }));
  $('#close').addEventListener('click', async () => {
    if (n < present.length) {
      const ok = await ask(`아직 ${present.length - n}명이 내지 않았어요.<br>그래도 마감할까요?`, { ok: '마감하기' });
      if (!ok) return;
    }
    gUpdate({ step: 'decide' });
  });
}

// 결과 보고 다음 결정
function avgBars(a) {
  if (!a) return '<p class="hint">평가를 모으는 중이에요…</p>';
  return `<div class="bars">${Q.map((q) => `<div class="bar" style="--c:${q.c}"><span>${q.name}</span><span class="tr"><i style="width:${((a[q.k] || 0) / 5) * 100}%"></i></span><span class="num">${fmt1(a[q.k])}</span></div>`).join('')}</div>`;
}

function compareTable(gd, upto) {
  const rows = [];
  for (let r = 1; r <= upto; r++) {
    const rec = recipeOf(gd.rounds?.[r]);
    if (!rec) continue;
    const s = roundSumm(r);
    rows.push(`<tr class="${gd.best === r ? 'best' : ''}"><td>시제품 ${r}${gd.best === r ? ' ★' : ''}</td>${ING.map((i) => `<td class="num">${rec[i.k]}</td>`).join('')}<td class="num">${fmt1(s?.avg?.overall)}</td></tr>`);
  }
  return `<table class="tbl"><thead><tr><th></th>${ING.map((i) => `<th>${i.short}</th>`).join('')}<th>종합</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function bestRound(gd) {
  let best = [];
  let top = -1;
  for (let r = 1; r <= gd.round; r++) {
    const v = roundSumm(r)?.avg?.overall;
    if (v == null) continue;
    if (v > top + 1e-9) { top = v; best = [r]; } else if (Math.abs(v - top) < 1e-9) best.push(r);
  }
  return best;
}

function decideView(head, gd, L) {
  const r = gd.round;
  const s = roundSumm(r);
  // 기본 2번: 1번 뒤에는 '고쳐서 다시'가 먼저, 2번 뒤에는 '끝내기'가 먼저 (시간 남으면 3번)
  const more = r < BASE_ROUNDS;
  const btns = L ? `<div class="foot">
      ${more ? `<button class="btn block" id="next">결과 보고 고쳐서 시제품 ${r + 1} 만들기</button>` : ''}
      <button class="btn block ${more ? 'ghost' : ''}" id="end">개발 끝내기 → 최종안 고르기</button>
      ${!more && r < MAX_ROUNDS ? `<button class="btn ghost sm" id="next">시간이 남으면: 시제품 ${r + 1} 만들기</button>` : ''}</div>`
    : `<p class="hint" style="margin-top:14px">${more ? '평균 막대를 보고 <b>무엇을 고칠지</b> 같이 이야기해요.' : '어느 시제품을 최종안으로 할지 같이 이야기해요.'}</p>`;
  view(`${head}<div class="split"><div><h2>시제품 ${r} <span class="hl">결과</span></h2>
      <p class="hint">모둠 평균 · ${s?.n ?? 0}명 평가</p>${avgBars(s?.avg)}</div>
    <div><h2 style="font-size:1.4rem;margin-top:14px">지금까지 비교</h2>${compareTable(gd, r)}${more ? TIPS : ''}</div></div>${btns}`, 'decide');
  if (!L) return;
  $('#next')?.addEventListener('click', async () => {
    const ok = await ask(`시제품 ${r + 1}을 만들까요?<br>직전 레시피에서 시작해서 고쳐요.`, { ok: '만들기' });
    if (!ok) return;
    st.planKey = null;
    gUpdate({ round: r + 1, step: 'plan', [`rounds.${r + 1}`]: { plan: { ...recipeOf(gd.rounds?.[r]) } } });
  });
  $('#end').addEventListener('click', () => finishDevelop(gd));
}

async function finishDevelop(gd) {
  const cands = bestRound(gd);
  let best = cands[0] ?? gd.round;
  if (cands.length > 1) {
    best = await new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `<div class="modal-box"><p>종합 맛 점수가 같아요.<br>모둠 베스트를 골라 주세요.</p><div class="modal-btns">
        ${cands.map((r) => `<button class="btn ink" data-r="${r}">시제품 ${r}</button>`).join('')}<button class="btn ghost" data-r="0">취소</button></div></div>`;
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        wrap.remove();
        resolve(Number(b.dataset.r));
      });
      document.body.append(wrap);
    });
    if (!best) return;
  } else {
    const ok = await ask(`개발을 끝낼까요?<br>최종안: <b>시제품 ${best}</b> (종합 맛이 가장 높은 것)`, { ok: '끝내기' });
    if (!ok) return;
  }
  gUpdate({ step: 'done', best });
}

function doneView(head, gd) {
  view(`${head}<div class="wait"><div class="big">개발 완료!</div>
    <p class="hint">우리 모둠 최종안: <b>시제품 ${gd.best ?? '–'}</b><br>시음회를 기다려요.</p></div>${compareTable(gd, gd.round)}`, 'done');
}

// ---------- ③ 시음회 ----------
const PRED = { more: '더', same: '비슷', less: '덜' };

function renderTasting() {
  const gd = st.gdoc;
  const t = st.sess.tasting || {};
  main.classList.toggle('wide', false);
  if (!gd) return view(`${topBar()}<div class="center"><span class="spin"></span></div>`);
  const isSomm = gd.sommelier === st.stu;
  if (t.phase === 'open' && isSomm) {
    syncTaste(true);
    return sommelierView(t);
  }
  if (t.phase === 'prep' && isLeader()) return leaderPrep(gd);
  const somm = gd.sommelier ? `<span class="num">${esc(gd.sommelier)}</span>${isSomm ? ' (나)' : ''}` : '아직 안 정함';
  const msg = t.phase === 'prep'
    ? (gd.sommelier ? '모둠장이 선정 이유를 쓰고 있어요. 같이 이야기해 주세요.' : '모둠에서 소믈리에 1명을 이야기해 정해요. 모둠장이 지정해요.')
    : '소믈리에가 블라인드로 맛보는 중이에요. 결과를 기다려요!';
  view(`${topBar()}<h2>반 대표 <span class="hl">블라인드 시음회</span></h2><p class="hint">${msg}</p>
    <div class="box flat" style="margin-bottom:12px"><b>우리 모둠 소믈리에</b><div style="font-size:1.4rem;font-weight:800">${somm}</div></div>
    <div class="box flat"><b>선정 이유</b><p style="margin-top:4px;white-space:pre-wrap">${esc(gd.reason) || '<span class="mute">작성 중…</span>'}</p>
      <p class="hint" style="margin:8px 0 0">학급 평균보다 단맛 ${PRED[gd.predSweet] || '–'} · 신맛 ${PRED[gd.predSour] || '–'}</p></div>`, 'tmember');
}

const saveReason = debounce((v) => gUpdate({ reason: v }), 600);

function leaderPrep(gd) {
  const chips = candidates().map((m) => `<button class="${gd.sommelier === m ? 'on' : ''}" data-somm="${esc(m)}"><span class="num">${esc(m)}</span>${m === st.stu ? ' (나)' : ''}</button>`).join('');
  const pred = (k, label) => `<p style="font-weight:800;margin:12px 0 6px">학급 평균보다 ${label}</p><div class="choice">
    ${['more', 'same', 'less'].map((v) => `<button data-pk="${k}" data-pv="${v}" class="${gd[k] === v ? 'on' : ''}">${{ more: `더 ${label === '단맛' ? '달다' : '시다'}`, same: '비슷하다', less: `덜 ${label === '단맛' ? '달다' : '시다'}` }[v]}</button>`).join('')}</div>`;
  view(`${topBar()}<h2>시음회 <span class="hl">준비</span></h2>
    <p class="hint">우리 모둠 최종안: 시제품 ${gd.best ?? '–'} · 선생님이 이 레시피로 100 mL를 만들어요.</p>
    <p style="font-weight:800;margin:6px 0">1. 소믈리에 정하기</p>
    <p class="hint" style="margin:0 0 6px">모둠에서 이야기해 1명을 정하고 눌러요. 소믈리에는 모든 모둠의 컵을 블라인드로 맛보고 점수를 매겨요.</p>
    <div class="choice">${chips}</div>
    ${gd.sommelier ? `<div class="note g" style="margin-top:8px">소믈리에: <b class="num">${esc(gd.sommelier)}</b></div>` : ''}
    <p style="font-weight:800;margin:14px 0 6px">2. 베스트로 고른 이유 (두 문장)</p>
    <textarea class="in" id="reason" maxlength="300" placeholder="예) 오미자 신맛을 사과즙으로 부드럽게 했다. 모둠원 평가에서 종합 맛이 가장 높았다.">${esc(gd.reason || '')}</textarea>
    <p style="font-weight:800;margin:14px 0 0">3. 2차시 예측: 우리 음료는…</p>
    ${pred('predSweet', '단맛')}${pred('predSour', '신맛')}
    <p class="hint" style="margin-top:14px">자동으로 저장돼요.</p>`, 'lprep');
  main.querySelectorAll('[data-somm]').forEach((b) => b.addEventListener('click', () => gUpdate({ sommelier: b.dataset.somm })));
  main.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => gUpdate({ [b.dataset.pk]: b.dataset.pv })));
  const ta = $('#reason');
  ta.addEventListener('input', () => saveReason(ta.value.trim()));
  ta.addEventListener('blur', () => { gUpdate({ reason: ta.value.trim() }); setTimeout(render, 50); });
}

function sommelierView(t) {
  const order = seededShuffle(t.cups || [], sid + st.stu);
  st.tasteDraft = { ...(st.taste?.scores || {}), ...(st.tasteDraft || {}) };
  const sc = st.tasteDraft;
  if (!st.tasteCur || !order.includes(st.tasteCur)) st.tasteCur = order.find((c) => !sc[c]) || order[0];
  const cur = st.tasteCur;
  const left = order.filter((c) => !sc[c]).length;
  const chips = order.map((c, i) => `<span class="${c === cur ? 'now' : sc[c] ? 'done' : ''}" data-cup="${c}">${i + 1}. ${c}${sc[c] ? ` · ${sc[c]}` : ''}</span>`).join('');
  view(`${topBar('<span class="pill">소믈리에</span>')}
    <h2>블라인드 <span class="hl">시음</span></h2>
    <p class="hint">이 순서대로 맛봐요. 컵 사이에는 물로 입을 헹궈요.</p>
    <div class="order">${chips}</div>
    <div class="box" style="text-align:center">
      <p style="font-weight:800">컵 번호</p><div class="cupnum" style="margin:6px 0 14px">${cur}</div>
      <p style="font-weight:800;margin-bottom:8px">종합 맛 <span class="mute">(1 별로 · 5 최고)</span></p>
      <div class="score5">${[1, 2, 3, 4, 5].map((v) => `<button data-s="${v}" class="${sc[cur] === v ? 'on' : ''}">${v}</button>`).join('')}</div>
    </div>
    <div class="foot">${left ? `<p class="hint" style="text-align:center">${left}잔 남았어요</p>` : '<div class="note g" style="text-align:center">모두 맛봤어요! 점수가 저장됐어요.</div>'}</div>`, 'somm');
  main.querySelectorAll('[data-cup]').forEach((b) => b.addEventListener('click', () => { st.tasteCur = b.dataset.cup; render(); }));
  main.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', async () => {
    sc[cur] = Number(b.dataset.s);
    st.tasteCur = order.find((c) => !sc[c]) || cur;
    render();
    try {
      await setDoc(doc(db, 'sessions', sid, 'tastes', st.stu), { g: st.g, stu: st.stu, by: st.uid, scores: { ...sc }, at: serverTimestamp() });
    } catch (e) {
      console.error(e);
      toast('저장하지 못했어요. 시음 시간이 끝났을 수 있어요.');
    }
  }));
}

// ---------- ④ 결과 ----------
function renderReveal() {
  const res = st.sess.results;
  const mine = res?.groups?.[st.g];
  const win = res?.winners?.includes(st.g);
  view(`${topBar()}<div class="wait">
    ${win ? `<div class="big">🏆 우리 반<br><span class="hl">최우수 레시피!</span></div>` : '<div class="big">TV를 봐요!</div>'}
    <p class="hint">시음회 점수 <b class="num">${fmt1(mine?.tasting)}</b> · 모둠 내 종합 맛 <b class="num">${fmt1(mine?.inGroup)}</b></p></div>
    ${mine?.recipe ? `<div class="box flat"><b>우리 모둠 최종안 (시제품 ${mine.best})</b><div style="margin-top:8px">${recipeRows(mine.recipe)}</div></div>` : ''}`, 'reveal');
}

start();
