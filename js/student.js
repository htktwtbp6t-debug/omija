// 학생 화면 (모둠장 패드·소믈리에 포함)
import {
  db, studentSignIn, doc, collection, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp,
} from './fb.js';
import {
  $, esc, ING, Q, TOTAL, MAX_ROUNDS, gColor, emptyRecipe, sumRecipe, recipeOf, cylinder,
  seededShuffle, fmt1, toast, ask, debounce,
} from './util.js';

const main = $('#main');
const sid = new URLSearchParams(location.search).get('s');

const st = {
  uid: null, stu: null, sess: null, claims: new Set(),
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
  } catch (e) {
    console.error(e);
    view(`<div class="center"><div><h2>접속 오류</h2><p class="hint">와이파이를 확인하고 새로고침해 주세요.</p></div></div>`);
    return;
  }
  // 서버 확인 전(캐시만 본 상태)에는 '없음'으로 판단하지 않고 연결 중으로 기다린다
  const meta = { includeMetadataChanges: true };
  connecting();
  unsub.dev = onSnapshot(doc(db, 'sessions', sid, 'devices', st.uid), meta, (d) => {
    if (d.exists()) { st.stu = d.data().stu; st.devReady = true; }
    else if (!d.metadata.fromCache) st.devReady = true;
    if (st.devReady) { syncGroup(); render(); }
  }, (e) => console.error('device', e));

  unsub.sess = onSnapshot(doc(db, 'sessions', sid), meta, (s) => {
    if (!s.exists()) {
      if (s.metadata.fromCache) return connecting();
      view(`<div class="center"><div><h2>수업을 찾을 수 없어요</h2><p class="hint">QR을 다시 찍어 주세요.</p></div></div>`);
      return;
    }
    st.sess = s.data();
    syncGroup();
    render();
  }, (e) => {
    console.error(e);
    view(`<div class="center"><div><h2>들어갈 수 없는 수업이에요</h2><p class="hint">QR을 다시 찍어 주세요.</p></div></div>`);
  });
  unsub.claims = onSnapshot(collection(db, 'sessions', sid, 'claims'), (qs) => {
    st.claims = new Set(qs.docs.map((d) => d.id));
    render();
  }, () => {});
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
function syncGroup() {
  const s = st.sess;
  let g = null;
  if (st.stu && s.groupsConfirmed && s.groups) {
    for (const [k, v] of Object.entries(s.groups)) if (v.members?.includes(st.stu)) g = k;
  }
  if (g === st.g) return;
  st.g = g;
  unsub.g?.(); unsub.summ?.();
  st.gdoc = null; st.summ = null;
  if (!g) return;
  unsub.g = onSnapshot(doc(db, 'sessions', sid, 'groups', g), (d) => {
    st.gdoc = d.exists() ? d.data() : null;
    syncRating();
    render();
  }, () => {});
  unsub.summ = onSnapshot(doc(db, 'sessions', sid, 'summaries', g), (d) => {
    st.summ = d.exists() ? d.data() : null;
    render();
  }, () => {});
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

  if (!st.stu) return s.open ? renderPick() : view(closedHtml());
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
function renderPick() {
  const s = st.sess;
  const absent = new Set(s.absent || []);
  const btns = s.roster.map((n) => {
    const off = st.claims.has(n) || absent.has(n);
    return `<button data-stu="${esc(n)}" ${off ? 'disabled' : ''}>${esc(n)}</button>`;
  }).join('');
  view(`<h2>내 학번을<br><span class="hl">골라요</span></h2>
    <p class="hint">한 번 고르면 이 기기에서는 바꿀 수 없어요. 회색은 이미 접속한 학번이에요.</p>
    <div class="picker">${btns}</div>`, 'pick');
  main.querySelectorAll('[data-stu]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.stu)));
}

async function pick(stu) {
  const ok = await ask(`<b class="num" style="font-size:2rem">${esc(stu)}</b><br>내 학번이 맞나요? 이 기기는 이 학번으로 잠겨요.`, { ok: '맞아요', cancel: '다시 고를래요' });
  if (!ok) return;
  const b = writeBatch(db);
  b.set(doc(db, 'sessions', sid, 'claims', stu), { uid: st.uid, at: serverTimestamp() });
  b.set(doc(db, 'sessions', sid, 'devices', st.uid), { stu, at: serverTimestamp() });
  try {
    await b.commit();
    st.stu = stu;
    syncGroup();
    render();
  } catch (e) {
    console.error(e);
    await ask('이 학번은 이미 다른 기기에서 쓰고 있거나 고를 수 없어요.<br>선생님께 말해 주세요.', { ok: '알겠어요', cancel: '' });
  }
}

// ---------- 모둠 배치 전후 ----------
function renderWaitGroup() {
  view(`${topBar()}<div class="wait grow">
    <span class="spin"></span>
    <div class="big">모둠 배치를<br>기다리는 중</div>
    <p class="hint">TV 화면을 봐 주세요.</p></div>`, 'waitg');
}

function renderMyGroup() {
  const brief = st.sess.stage === 'brief';
  const list = members().map((m) => `<div class="m"><span class="num">${esc(m)}</span>${m === leader() ? '<span class="pill">모둠장</span>' : ''}</div>`).join('');
  view(`${topBar()}
    <div class="wait"><span class="gchip bigchip" style="--c:${gColor(st.g)}">${st.g}</span>
      <div class="big">${st.g}모둠${isLeader() ? '<br><span class="hl">모둠장</span>' : ''}</div></div>
    ${brief ? `<div class="note y" style="margin-bottom:10px">시제품은 <b>최대 3번</b> 만들 수 있어요.</div>
      <div class="note" style="margin-bottom:14px">모둠 레시피는 하나! 같이 정한 배합으로 한 컵만 만들어요.</div>` : ''}
    <div class="members">${list}</div>
    ${isLeader() ? '<p class="hint" style="margin-top:14px">모둠장 화면에 단계별 안내가 나와요. 선생님이 시작하면 바로 배합을 정할 수 있어요.</p>' : ''}`, 'mygroup');
}

// ---------- ② 개발 ----------
const STEPS = [['plan', '배합'], ['make', '계량'], ['label', '라벨'], ['rate', '맛 평가'], ['decide', '결정']];

function stepBar(step) {
  const idx = STEPS.findIndex(([k]) => k === step);
  return `<div class="stepbar">${STEPS.map(([, n], i) => `<div class="${i < idx || step === 'done' ? 'done' : i === idx ? 'now' : ''}">${n}</div>`).join('')}</div>`;
}

function renderDevelop() {
  const gd = st.gdoc;
  if (!gd) return view(`${topBar()}<div class="center"><span class="spin"></span></div>`);
  const r = gd.round;
  const head = `${topBar(`<span class="pill">시제품 ${Math.min(r, MAX_ROUNDS)} / ${MAX_ROUNDS}</span>`)}${gd.step === 'done' ? '' : stepBar(gd.step)}`;
  const L = isLeader();
  main.classList.toggle('wide', L);
  if (st.proxy && !(L && gd.step === 'rate')) st.proxy = null;

  switch (gd.step) {
    case 'plan': return L ? leaderPlan(head, gd) : memberPlan(head, gd);
    case 'make': return L ? leaderMake(head, gd) : memberMake(head, gd);
    case 'label': return L ? leaderLabel(head, gd) : memberLabel(head, gd);
    case 'rate': return L ? leaderRate(head, gd) : memberRate(head, gd);
    case 'decide': return decideView(head, gd, L);
    default: return doneView(head, gd);
  }
}

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
    <h2>시제품 ${r}: <span class="hl">배합 정하기</span></h2>
    <p class="hint">${r > 1 ? '직전 시제품 배합에서 시작해요. ' : ''}모둠이 함께 정하고, 합계를 20 mL로 맞춰요.</p>
    <div class="plan-wrap"><div class="vis">${cylinder(p, tot > TOTAL ? 'over' : '')}
      <div class="tot ${tot !== TOTAL ? 'bad' : ''}">${tot}<small> / ${TOTAL} mL</small></div></div>
      <div>${rows}<p class="note" style="margin-top:6px">모둠 레시피는 하나! 같이 정한 배합으로 한 컵만.</p></div></div>
    <div class="foot"><button class="btn block" id="go" ${tot === TOTAL ? '' : 'disabled'}>${tot === TOTAL ? '이 배합으로 만들기' : tot < TOTAL ? `${TOTAL - tot} mL 더 넣어야 해요` : `${tot - TOTAL} mL 많아요`}</button></div>`, 'plan');
  main.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    p[k] = Math.max(0, Math.min(TOTAL, p[k] + Number(b.dataset.d)));
    savePlan(r, { ...p });
    renderDevelop();
  }));
  $('#go').addEventListener('click', () => {
    gUpdate({ [`rounds.${r}`]: { plan: { ...p }, actual: { ...p }, checked: {} }, step: 'make' });
  });
}

function recipeRows(rec) {
  return ING.map((i) => `<div class="ing step-row" style="--c:${i.color}"><span class="sw"></span><span>${i.name}</span><span class="v">${rec?.[i.k] ?? 0}<small>mL</small></span></div>`).join('');
}

function memberPlan(head, gd) {
  const p = gd.rounds?.[gd.round]?.plan || emptyRecipe();
  const tot = sumRecipe(p);
  view(`${head}<h2>시제품 ${gd.round}: <span class="hl">배합 정하기</span></h2>
    <p class="hint">모둠장 화면에 같이 정한 배합을 입력하고 있어요.</p>
    <div class="plan-wrap"><div class="vis">${cylinder(p)}<div class="tot ${tot !== TOTAL ? 'bad' : ''}">${tot}<small> / ${TOTAL} mL</small></div></div>
    <div>${recipeRows(p)}</div></div>
    <p class="note" style="margin-top:12px">모둠 레시피는 하나! 각자 따로 만들지 않아요.</p>`, 'mplan');
}

// 계량해 만들기
function leaderMake(head, gd) {
  const r = gd.round;
  const rd = gd.rounds?.[r] || {};
  const plan = rd.plan || emptyRecipe();
  const act = { ...plan, ...(rd.actual || {}) };
  const ck = rd.checked || {};
  const isOk = (k) => ck[k] || (plan[k] === 0 && act[k] === 0);
  const allOk = ING.every((i) => isOk(i.k));
  const rows = ING.map((i) => {
    const diff = act[i.k] !== plan[i.k];
    return `<div class="ing mk ${isOk(i.k) ? 'ok' : ''} ${diff ? 'diff' : ''}" style="--c:${i.color}"><span class="sw"></span>
      <span>${i.short}${diff ? `<span class="flag">계획 ${plan[i.k]}→${act[i.k]}</span>` : ''}</span>
      <span class="stepper"><button data-k="${i.k}" data-d="-1">−</button><span class="v">${act[i.k]}<small>mL</small></span><button data-k="${i.k}" data-d="1">+</button></span>
      <button class="ck" data-ck="${i.k}" aria-label="${i.short} 넣음"></button></div>`;
  }).join('');
  const tot = sumRecipe(act);
  view(`${head}<h2>넣을 때마다 <span class="hl">체크!</span></h2>
    <p class="hint">계획과 다르게 넣었으면 −/+로 실제 값을 고쳐요. 재료마다 주사기를 따로 써요.</p>
    <div class="plan-wrap"><div class="vis">${cylinder(Object.fromEntries(ING.map((i) => [i.k, isOk(i.k) ? act[i.k] : 0])))}
      <div class="tot">${ING.reduce((s, i) => s + (isOk(i.k) ? act[i.k] : 0), 0)}<small> / ${tot} mL</small></div></div>
      <div>${rows}</div></div>
    <div class="foot"><button class="btn block" id="go" ${allOk ? '' : 'disabled'}>${allOk ? '다 넣었어요' : '재료를 넣고 체크해요'}</button>
      <button class="btn ghost sm" id="back">← 배합 다시 정하기</button></div>`, 'make');
  main.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    const v = Math.max(0, Math.min(TOTAL * 2, act[k] + Number(b.dataset.d)));
    gUpdate({ [`rounds.${r}.actual.${k}`]: v });
  }));
  main.querySelectorAll('[data-ck]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ck;
    gUpdate({ [`rounds.${r}.checked.${k}`]: !ck[k] });
  }));
  $('#go').addEventListener('click', () => gUpdate({ step: 'label' }));
  $('#back').addEventListener('click', () => {
    st.planKey = null;
    gUpdate({ step: 'plan' });
  });
}

function memberMake(head, gd) {
  const rd = gd.rounds?.[gd.round] || {};
  const act = rd.actual || rd.plan || emptyRecipe();
  const ck = rd.checked || {};
  const rows = ING.map((i) => `<div class="ing step-row ${ck[i.k] ? 'ok' : ''}" style="--c:${i.color}"><span class="sw"></span><span>${i.short}</span><span class="v">${act[i.k]}<small>mL</small></span></div>`).join('');
  view(`${head}<h2>모둠장이 <span class="hl">만드는 중</span></h2>
    <ul class="hint" style="padding-left:1.2em;margin-bottom:12px"><li>재료마다 주사기를 따로 써요.</li><li>눈금은 눈높이에서 읽어요.</li><li>정한 양과 다르게 들어가면 정직하게 고쳐 적어요.</li></ul>
    <div class="plan-wrap"><div class="vis">${cylinder(act)}</div><div>${rows}</div></div>`, 'mmake');
}

function leaderLabel(head, gd) {
  view(`${head}<div class="wait grow"><div class="big">컵에<br><span class="hl">시제품 ${gd.round}</span><br>라벨 붙이기</div>
    <p class="hint">라벨을 붙이면 모둠원 모두 맛 평가를 시작해요.</p></div>
    <div class="foot"><button class="btn block" id="go">붙였어요 → 맛 평가 시작</button></div>`, 'label');
  $('#go').addEventListener('click', () => gUpdate({ step: 'rate' }));
}
function memberLabel(head, gd) {
  view(`${head}<div class="wait grow"><div class="big">곧 맛 평가!</div><p class="hint">모둠장이 컵에 '시제품 ${gd.round}' 라벨을 붙이고 있어요.</p></div>`, 'mlabel');
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
      <p class="hint">모둠원이 모두 내면 모둠장이 결과를 열어요.</p>
      <button class="btn ghost sm" id="edit">점수 고치기</button></div>`, 'mrated');
    $('#edit').addEventListener('click', () => {
      st.editing = true;
      st.draft = Object.fromEntries(Q.map((q) => [q.k, st.myRating[q.k]]));
      renderDevelop();
    });
    return;
  }
  view(`${head}${ratingForm(`시제품 ${gd.round} <span class="hl">맛보기</span>`, '한 모금 → 물로 입 헹구기. 막대를 눌러 점수를 골라요.', st.stu, false)}`, 'rate');
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
  const btns = L ? `<div class="foot">
      ${r < MAX_ROUNDS ? `<button class="btn block" id="next">다음 시제품 만들기 (${r + 1}/${MAX_ROUNDS})</button>` : ''}
      <button class="btn block ${r < MAX_ROUNDS ? 'ghost' : ''}" id="end">개발 끝내기</button></div>` : '<p class="hint" style="margin-top:14px">결과를 보고 다음 배합을 같이 이야기해요.</p>';
  view(`${head}<div class="split"><div><h2>시제품 ${r} <span class="hl">결과</span></h2>
      <p class="hint">모둠 평균 · ${s?.n ?? 0}명 평가</p>${avgBars(s?.avg)}</div>
    <div><h2 style="font-size:1.4rem;margin-top:14px">지금까지 비교</h2>${compareTable(gd, r)}</div></div>${btns}`, 'decide');
  if (!L) return;
  $('#next')?.addEventListener('click', async () => {
    const ok = await ask(`시제품 ${r + 1}을 만들까요?<br>직전 배합에서 시작해요.`, { ok: '만들기' });
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
    const ok = await ask(`개발을 끝낼까요?<br>모둠 베스트: <b>시제품 ${best}</b>`, { ok: '끝내기' });
    if (!ok) return;
  }
  gUpdate({ step: 'done', best });
}

function doneView(head, gd) {
  view(`${head}<div class="wait"><div class="big">개발 완료!</div>
    <p class="hint">모둠 베스트: <b>시제품 ${gd.best ?? '–'}</b><br>시음회를 기다려요.</p></div>${compareTable(gd, gd.round)}`, 'done');
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
    ? '모둠장 화면에서 소믈리에를 정하고 선정 이유를 써요. 같이 이야기해 주세요.'
    : '소믈리에가 블라인드로 맛보는 중이에요. 결과를 기다려요!';
  view(`${topBar()}<h2>반 대표 <span class="hl">블라인드 시음회</span></h2><p class="hint">${msg}</p>
    <div class="box flat" style="margin-bottom:12px"><b>우리 모둠 소믈리에</b><div style="font-size:1.4rem;font-weight:800">${somm}</div></div>
    <div class="box flat"><b>선정 이유</b><p style="margin-top:4px;white-space:pre-wrap">${esc(gd.reason) || '<span class="mute">작성 중…</span>'}</p>
      <p class="hint" style="margin:8px 0 0">학급 평균보다 단맛 ${PRED[gd.predSweet] || '–'} · 신맛 ${PRED[gd.predSour] || '–'}</p></div>`, 'tmember');
}

const saveReason = debounce((v) => gUpdate({ reason: v }), 600);

function leaderPrep(gd) {
  const chips = members().map((m) => `<button class="${gd.sommelier === m ? 'on' : ''}" data-somm="${esc(m)}"><span class="num">${esc(m)}</span></button>`).join('');
  const pred = (k, label) => `<p style="font-weight:800;margin:12px 0 6px">학급 평균보다 ${label}</p><div class="choice">
    ${['more', 'same', 'less'].map((v) => `<button data-pk="${k}" data-pv="${v}" class="${gd[k] === v ? 'on' : ''}">${{ more: `더 ${label === '단맛' ? '달다' : '시다'}`, same: '비슷하다', less: `덜 ${label === '단맛' ? '달다' : '시다'}` }[v]}</button>`).join('')}</div>`;
  view(`${topBar()}<h2>시음회 <span class="hl">준비</span></h2>
    <p class="hint">모둠 베스트: 시제품 ${gd.best ?? '–'} · 선생님이 이 레시피로 100 mL를 만들어요.</p>
    <p style="font-weight:800;margin:6px 0">1. 소믈리에 1명을 정해 눌러요</p><div class="choice">${chips}</div>
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
    ${mine?.recipe ? `<div class="box flat"><b>우리 모둠 베스트 (시제품 ${mine.best})</b><div style="margin-top:8px">${recipeRows(mine.recipe)}</div></div>` : ''}`, 'reveal');
}

start();
