// 발표 화면 (교사 노트북 → TV)
import { whenAuth, isTeacherUser, teacherSignIn, pageUrl } from './fb.js';
import { $, esc, ING, MAX_ROUNDS, BASE_ROUNDS, SUPPLIES, gColor, cylinder, qrSvg, illo, loadNames, fmt1, toast, ask, classLabel } from './util.js';
import {
  DECK, watchClass, stepSlide, setPop, drawGroups, confirmGroups, moveMember, setLeader, groupStatus,
} from './teacher.js';

const stage = $('#stage');
const sid = new URLSearchParams(location.search).get('s');
const names = loadNames();
let S = null;
let curId = null;
let lastHtml = '';
let seenDraw = null;
let shuffling = false;
let dropAnim = false;
let selected = null;

// ---------- 시작 ----------
async function start() {
  if (!sid) return gate('수업 코드가 없어요', '관리자 화면에서 [발표 화면]을 눌러 열어 주세요.');
  const u = await whenAuth();
  if (!(await isTeacherUser(u))) {
    gate('교사 로그인', '발표 화면은 선생님 Google 계정으로만 열 수 있어요.', true);
    return;
  }
  watchClass(sid, (st) => {
    if (st.error || !st.sess) return gate('수업을 열 수 없어요', '수업 코드가 맞는지 확인해 주세요.');
    S = st;
    render();
  });
}

function gate(title, msg, login = false) {
  stage.innerHTML = `<div class="gate"><div><h1>${title}</h1><p class="lead" style="font-size:18px;margin-bottom:20px">${msg}</p>
    ${login ? '<button class="btn" id="login">Google로 로그인</button>' : ''}</div></div>`;
  $('#login')?.addEventListener('click', async () => {
    try {
      const u = await teacherSignIn();
      if (!(await isTeacherUser(u))) return toast('교사 계정이 아니에요.');
      start();
    } catch (e) { console.error(e); toast('로그인하지 못했어요.'); }
  });
}

// ---------- 카운트다운 (교사가 리모컨에서 켤 때만) ----------
const timerEl = document.createElement('div');
timerEl.className = 'timer';
timerEl.hidden = true;
document.body.append(timerEl);
function tickTimer() {
  const end = S?.sess?.timer?.end;
  if (!end) { timerEl.hidden = true; return; }
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  timerEl.hidden = false;
  timerEl.classList.toggle('over', left === 0);
  timerEl.classList.toggle('soon', left > 0 && left <= 60);
  timerEl.textContent = left === 0 ? '시간 끝!' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
setInterval(tickTimer, 500);

// ---------- 그리기 ----------
const R = {};
function render() {
  tickTimer();
  const idx = S.sess.slide || 0;
  const sl = DECK[idx];
  let html = (R[sl.id] || (() => ''))();
  html += `<div class="pager">${idx + 1} / ${DECK.length}</div>`;
  const pop = S.sess.pop && sl.pops?.some(([k]) => k === S.sess.pop) ? S.sess.pop : null;
  if (pop) html += `<div class="pop" data-pop="${pop}"><div class="pin">${POP[pop]()}</div></div>`;
  else if (sl.pops) html += `<div class="popbtns">${sl.pops.map(([k, n]) => `<button class="sbtn" data-popk="${k}">${n}</button>`).join('')}</div>`;
  if (sl.id !== curId) {
    curId = sl.id;
    lastHtml = '';
    selected = null;
  }
  if (html === lastHtml) return;
  const fresh = !stage.firstElementChild || stage.firstElementChild.dataset.id !== sl.id;
  lastHtml = html;
  if (fresh) {
    stage.innerHTML = `<section class="slide ${sl.id === 'hook' ? 's1' : ''}" data-id="${sl.id}">${html}</section>`;
  } else {
    const el = stage.firstElementChild;
    el.style.animation = 'none';
    el.innerHTML = html;
  }
  AFTER[sl.id]?.(fresh);
  stage.querySelectorAll('[data-popk]').forEach((b) => b.addEventListener('click', () => setPop(S, b.dataset.popk)));
  stage.querySelector('.pop')?.addEventListener('click', () => setPop(S, S.sess.pop));
}

const today = () => {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
const cls = () => classLabel(S.sess.classId);
const groupKeys = () => Object.keys(S.sess.groups || {}).sort();
const nm = (stu) => names[stu] || '';

R.hook = () => `<div class="l">
    <span class="pill" style="align-self:flex-start">과탐실2 · ${cls()} · ${today()}</span>
    <h1>‘맛있다’를 <span class="r">숫자</span>로<br>말할 수 있을까?<br><span class="box2">오늘은 레시피 찾기</span></h1>
    <p class="q"><b>우리 동네 특산품</b> 오미자로 음료를 만들고,<br>맛있는 음료가 어떤지 <b>데이터</b>로 남겨 보자.</p>
    <div class="loop"><span class="k">오늘 · 레시피 찾기</span><em>→</em><span>맛을 점수로 기록</span><em>→</em><span>맛있는 음료의 데이터</span></div>
  </div>
  <div class="rc">${cylinder({ omija: 7, pear: 5, syrup: 4, water: 4 })}<div class="badge">오미자<small>다섯 가지 맛</small></div></div>
  <div class="marq"><div>${'<span>안전</span><span class="s">✦</span><span>손 씻기</span><span class="s">✦</span><span>정직한 기록</span><span class="s">✦</span><span>먹었으면 평가</span><span class="s">✦</span><span>협력</span><span class="s">✦</span>'.repeat(2)}</div></div>`;

R.process = () => `<div class="hd"><h2>탐구의 <span class="r">큰 그림</span></h2><span class="pill">오늘 할 탐구</span></div>
  <div class="road">
    <div class="box now"><span class="tag">오늘</span><b>맛있는 레시피 찾기</b><p>사람의 감각으로 평가 (관능평가)</p>
      <div class="mini"><span>만들기</span><em>→</em><span>맛 평가</span><em>→</em><span>고치기</span><em>↺ 2~3번</em></div>
      <div class="mini"><span>반 대표 블라인드 시음회</span></div></div>
    <em>→</em>
    <div class="box"><span class="tag">기록</span><b>데이터로 남기기</b><p>느낌을 말로만 하지 않고</p>
      <div class="mini"><span>레시피 → mL 숫자</span></div><div class="mini"><span>맛 → 1~5점</span></div><div class="mini"><span>모둠·반 평균</span></div></div>
    <em>→</em>
    <div class="box end"><b>맛있는 음료의<br>데이터</b><p>가능한 한<br>객관적으로!</p></div>
  </div>
  <p class="lead" style="text-align:center;margin-top:3cqi">‘맛있다’는 느낌을 <b>가능한 한 객관적인 자료</b>로 남겨 보자. 오늘은 <b class="r">그 레시피를 찾는 날</b>이에요.</p>`;

R.promise = () => `<div class="hd"><h2>우리 동네 특산품 <span class="r">오미자</span>로 음료를 만들어 보자</h2></div>
  <div class="omi"><p class="lead">오미자(五味子) = <b>다섯 가지 맛</b>이 난다는 열매</p>
    <div class="tastes5"><span style="background:var(--g2)">단맛</span><span style="background:var(--g3)">신맛</span><span>쓴맛</span><span>짠맛</span><span style="background:var(--g1);color:#fff">매운맛</span></div></div>
  <h3 class="sub">오늘의 약속</h3>
  <div class="promise">
    <div class="box"><div class="ic">🧤</div><b>안전</b><p>실험 도구는 정해진 용도로만.<br>맛보기 전에 손 씻기.</p></div>
    <div class="box" style="background:#FFF4D6"><div class="ic">📏</div><b>정직한 기록</b><p>넣은 양 그대로 입력.<br>내 입맛대로 솔직하게 평가.</p></div>
    <div class="box" style="background:#E7F8F0"><div class="ic">🤝</div><b>협력</b><p>레시피는 모둠이 함께 정하고<br>큰 컵에 만들어 나눠 마신다.</p></div>
  </div>
  <div class="mini-note"><span>손 씻기</span><span>알레르기 있는 사람은 미리 말하기</span><span>시음은 한 모금씩</span></div>`;

const studentUrl = () => pageUrl('index.html', { s: sid });
R.join = () => {
  const ro = S.sess.roster || [];
  const ab = new Set(S.sess.absent || []);
  const on = ro.filter((s) => S.claims[s]).length;
  return `<div class="hd"><h2>QR로 <span class="r">접속</span>하기</h2><span class="pill light">접속하면 출석 확인</span><span class="pill">${cls()}</span></div>
  <div class="join"><div class="qrbox">${qrSvg(studentUrl())}</div>
    <div><p class="lead">카메라로 QR을 찍고 <b>내 학번</b>을 골라요.<br>기기가 없으면 손을 들어 알려 주세요.</p>
      <p class="count" style="margin-top:2cqi">${on}<small> / ${ro.length - ab.size}명 접속</small></p>
      <div class="seats">${ro.map((s) => `<span class="${S.claims[s] ? 'on' : ab.has(s) ? 'ab' : ''}">${s}</span>`).join('')}</div></div></div>`;
};

R.group = () => {
  const gs = groupKeys();
  const ab = new Set(S.sess.absent || []);
  const confirmed = S.sess.groupsConfirmed;
  const btns = `<div class="gstate">
    ${gs.length ? `<span class="pill ${confirmed ? '' : 'light'}">${confirmed ? '확정!' : '확정 전 · 카드를 눌러 옮길 수 있어요'}</span>` : ''}
    <button class="sbtn ${gs.length ? '' : 'hot'}" data-act="draw">${gs.length ? '다시 뽑기' : '모둠 뽑기'}</button>
    ${gs.length && !confirmed ? '<button class="sbtn hot" data-act="confirm">확정</button>' : ''}</div>`;
  if (shuffling || !gs.length) {
    const present = (S.sess.roster || []).filter((s) => !ab.has(s));
    return `<div class="hd"><h2>모둠 <span class="r">배치</span></h2>${btns}</div>
      <div class="shuffle">${present.map((s, i) => `<div class="pcard" style="--rot:${(i % 5) - 2}deg;animation-delay:${(i % 7) * 40}ms"><span class="n">${s}</span>&nbsp;${esc(nm(s))}</div>`).join('')}</div>`;
  }
  let k = 0;
  const cols = gs.map((g) => {
    const grp = S.sess.groups[g];
    const cards = grp.members.map((m) => {
      const lead = grp.leader === m;
      const i = k++;
      return `<div class="pcard ${dropAnim ? 'anim' : ''} ${lead ? 'lead' : ''} ${S.claims[m] ? '' : 'off'} ${selected === m ? 'sel' : ''}" data-stu="${m}" style="--rot:${(i * 37) % 17 - 8}deg;animation-delay:${i * 90}ms">
        <span><span class="n">${m}</span> ${esc(nm(m))}</span>${lead ? '<span class="star">모둠장</span>' : selected === m ? '<span class="star" data-lead="1">모둠장으로</span>' : ''}</div>`;
    }).join('');
    return `<div class="gcol" style="--c:${gColor(g)}"><div class="h" data-g="${g}">${g}<small>${selected ? '여기로 옮기기' : `${grp.members.length}명`}</small></div><div class="b">${cards}</div></div>`;
  }).join('');
  return `<div class="hd"><h2>모둠 <span class="r">배치</span></h2>${btns}</div>
    <div class="gcols" style="grid-template-columns:repeat(${gs.length},1fr)">${cols}</div>`;
};

R.supplies = () => `<div class="hd"><h2>모둠별 <span class="r">준비물</span> 챙기기</h2><span class="pill">모둠장 화면에서 체크!</span></div>
  <div class="sup">${SUPPLIES().map((x) => `<div class="box">${illo([`${x.ic}::`])}<b>${x.name}</b><span class="q">${x.qty}</span><p>${x.note}</p></div>`).join('')}</div>
  <div class="suprow"><div class="box">${illo(['cup:#D9264A:오미자', 'cup:#C8DC8A:배즙', 'cup:#F4E7C6:알룰로스', 'cup:#9CD2EA:정수', 'big:#ffffff:제작용(빈 컵)'])}</div>
    <p class="lead">재료는 앞에서 <b>플라스틱 컵 4개</b>에 받아 가요.<br>큰 컵 하나는 <b>비워 두고</b> 모둠 음료를 만들 때 써요.</p></div>`;

// 다음을 누를 때마다 하나씩 (sess.sub = 보이는 항목 수)
R.rules = () => {
  const n = S.sess.sub || 7;
  const c = (i) => (i <= n ? `rv ${i === n ? 'new' : ''}` : 'rv off');
  const v = (i) => `class="${c(i)}"`;
  return `<div class="hd"><h2>재료와 <span class="r">규칙</span></h2><span class="pill light">${n} / 7</span></div>
  <div class="ings ${c(1)}">${ING.map((i) => `<div class="box flat" style="--c:${i.color}"><span class="sw"></span>${i.name}</div>`).join('')}</div>
  <div class="rules"><ul>
      <li ${v(2)}>레시피는 <b>한 사람 몫 20 mL</b> 기준, 1 mL 단위</li>
      <li ${v(3)}>큰 컵에는 <b>인원수만큼 곱해서</b> 만들어요 (화면이 계산해 줘요)</li>
      <li ${v(4)}>재료마다 <b>주사기를 따로</b> 써요</li>
      <li ${v(5)}>넣은 양이 다르면 <b>실제 넣은 값으로 고쳐요</b></li>
    </ul>
    <div><div class="shout ${c(6)}" style="background:var(--g2)">모둠 레시피 ${BASE_ROUNDS}번<small>시간이 남으면 3번까지. 마지막에 최종안 하나를 골라요</small></div>
      <div class="shout ${c(7)}" style="background:var(--g5)">마셨으면 꼭 평가!<small>각자 폰에서 5문항. 평가해야 결과가 나와요</small></div></div></div>`;
};

R.steps = () => `<div class="hd"><h2>오늘 <span class="r">하는 방법</span></h2><span class="pill">모둠장 화면이 단계마다 알려 줘요</span></div>
  <div class="how">
    <div class="box"><span class="no">1</span><b>각자 맛보기</b>${illo(['four::재료', '>', 'paper::내 컵'])}<p>내 시음 컵에 재료를 <b>마음대로</b> 조금씩 섞어 맛봐요. 기록은 안 해요.<br>어떤 재료가 어떤 맛을 내는지 느껴 보기!</p></div>
    <div class="box"><span class="no">2</span><b>모둠 레시피 정하기</b>${illo(['talk::의논', '>', 'pad::모둠장 입력'])}<p>맛본 걸 이야기해서 <b>레시피 하나</b>를 정해요.<br>모둠장이 20 mL 기준으로 입력.</p></div>
    <div class="box"><span class="no">3</span><b>큰 컵에 만들어 나눠 마시기</b>${illo(['syringe', '>', 'big::×인원수', '>', 'papers::한 컵씩'])}<p>화면에 나온 양대로 <b>큰 컵</b>에 넣고 저어서<br>각자 시음 컵에 나눠 따라요.</p></div>
    <div class="box"><span class="no">4</span><b>각자 폰으로 평가</b>${illo(['taste::맛보기', '>', 'phone::5문항'])}<p>마신 뒤 <b>바로 내 폰</b>에서 평가.<br>모둠 평균을 보고 고쳐서 <b>2 → 3 → 4를 한 번 더</b>!</p></div>
  </div>
  <p class="lead" style="margin-top:auto;text-align:center">마지막에 가장 맛있던 레시피 = <b class="r">우리 모둠 최종안</b> → 반 대표 블라인드 시음회로!</p>`;

R.board = () => {
  const gs = groupKeys();
  const cards = gs.map((g) => {
    const gd = S.groups[g];
    const st = groupStatus(S, g);
    const fin = gd?.step === 'done';
    const cups = Array.from({ length: MAX_ROUNDS }, (_, i) => {
      const r = i + 1;
      const rd = gd?.rounds?.[r];
      let f = 0;
      if (rd?.actual && (r < gd.round || ['label', 'rate', 'decide', 'done'].includes(gd.step))) f = 100;
      else if (r === gd?.round && gd.step === 'make') f = Math.round((Object.values(rd?.checked || {}).filter(Boolean).length / ING.length) * 100);
      return `<span class="cup ${r === gd?.round && !fin ? 'now' : ''}" style="--f:${f}%"></span>`;
    }).join('');
    const proxy = new Set(S.summaries[g]?.rounds?.[st.r]?.proxy || []);
    const pips = gd?.step === 'rate' || gd?.step === 'decide' || fin
      ? st.present.map((m) => `<i class="${proxy.has(m) ? 'px' : st.done.includes(m) || fin ? 'on' : ''}"></i>`).join('')
      : st.present.map(() => '<i></i>').join('');
    return `<div class="card ${fin ? 'fin' : ''}" style="--c:${gColor(g)}"><div class="h">${g}<small>모둠</small></div>
      <div class="b"><div class="cups">${cups}</div><div class="st">${st.text}<small>${st.sub}</small></div><div class="pips">${pips}</div></div></div>`;
  }).join('');
  return `<div class="hd"><h2>개발 현황</h2><span class="pill">모둠 레시피 ${BASE_ROUNDS}번 (+시간 되면 3번)</span></div>
    <div class="cards" style="grid-template-columns:repeat(${gs.length},1fr)">${cards}</div>`;
};

R.tprep = () => {
  const gs = groupKeys();
  const cups = S.sess.tasting?.cups || [];
  const cells = gs.map((g) => {
    const gd = S.groups[g] || {};
    const ok = (v) => (v ? '<span class="ok">✓</span>' : '<span class="mute">…</span>');
    return `<div class="tcell"><span class="gchip" style="--c:${gColor(g)}">${g}</span>
      소믈리에 ${ok(gd.sommelier)}<br>선정 이유 ${ok(gd.reason)}<br>2차시 예측 ${ok(gd.predSweet && gd.predSour)}</div>`;
  }).join('');
  return `<div class="hd"><h2>반 대표 <span class="r">블라인드 시음회</span></h2><span class="pill">선생님도 어느 모둠인지 몰라요</span></div>
    <div class="tsteps">
      <div class="box"><b>1. 소믈리에 1명</b>모둠에서 이야기해 정하고, 모둠장이 패드에서 지정해요.</div>
      <div class="box" style="background:#FFF4D6"><b>2. 선생님이 제조</b>컵 번호별 레시피로 100 mL씩. 어느 모둠 것인지는 비밀!</div>
      <div class="box" style="background:#E7F8F0"><b>3. 선정 이유 쓰기</b>베스트를 고른 이유 두 문장 + 2차시 예측.</div>
    </div>
    <div class="trow" style="grid-template-columns:repeat(${gs.length},1fr)">${cells}</div>
    <p class="lead" style="margin-top:auto">오늘의 컵: ${cups.map((c) => `<b class="num">${c}</b>`).join(' · ')}</p>`;
};

R.ttaste = () => {
  const cups = S.sess.tasting?.cups || [];
  const gs = groupKeys();
  const cells = gs.map((g) => {
    const somm = S.groups[g]?.sommelier;
    const t = somm ? S.tastes[somm] : null;
    const n = t ? Object.keys(t.scores || {}).length : 0;
    return `<div class="tcell"><span class="gchip" style="--c:${gColor(g)}">${g}</span>
      ${somm ? `${n} / ${cups.length}잔 ${n >= cups.length ? '<span class="ok">✓</span>' : ''}` : '<span class="mute">소믈리에 없음</span>'}</div>`;
  }).join('');
  const doneN = gs.filter((g) => {
    const somm = S.groups[g]?.sommelier;
    return somm && Object.keys(S.tastes[somm]?.scores || {}).length >= cups.length;
  }).length;
  return `<div class="hd"><h2>블라인드 <span class="r">시음</span></h2><span class="pill">소믈리에 ${doneN} / ${gs.length}명 완료</span></div>
    <p class="lead">소믈리에 화면에 나온 <b>순서대로</b> 맛보고 종합 맛을 1~5점으로 매겨요. 컵 사이에는 물로 입 헹구기!</p>
    <div class="cupbig">${cups.map((c) => `<span class="c">${c}</span>`).join('')}</div>
    <div class="trow" style="grid-template-columns:repeat(${gs.length},1fr);margin-top:auto">${cells}</div>`;
};

R.reveal = () => {
  const res = S.sess.results;
  if (!res) return '<div class="hd"><h2>결과 집계 중…</h2></div>';
  const cups = res.cups || [];
  const flips = cups.map((c) => `<div class="flip ${res.winners.includes(c.g) ? 'win' : ''}" style="--c:${gColor(c.g)}"><div class="in">
      <div class="f"><small>컵 번호</small><b>${c.cup}</b><small>?</small></div>
      <div class="k">${res.winners.includes(c.g) ? '<span class="crown">반 최우수</span>' : ''}<span class="gn">${c.g}모둠</span><span class="sc">${fmt1(c.avg)}<small>시음 평균 · ${c.n}명</small></span></div>
    </div></div>`).join('');
  const w = res.winners.map((g) => `${g}모둠`).join(', ');
  return `<div class="hd"><h2>컵의 <span class="r">주인</span>은?</h2><span class="pill">선생님도 지금 처음 알아요</span></div>
    <div class="flips" style="grid-template-columns:repeat(${Math.max(cups.length, 1)},1fr)">${flips}</div>
    <div class="winner">🏆 반 최우수 레시피: <span class="hl">${w || '–'}</span></div>`;
};

R.result = () => {
  const res = S.sess.results;
  if (!res) return '<div class="hd"><h2>결과 집계 중…</h2></div>';
  const rows = groupKeys().map((g) => {
    const x = res.groups?.[g] || {};
    const rec = x.recipe;
    const trend = Object.entries(x.rounds || {}).map(([, v]) => fmt1(v)).join(' → ');
    const win = res.winners.includes(g);
    return `<tr class="${win ? 'win' : ''}"><td><span class="gchip" style="--c:${gColor(g)}">${g}</span></td>
      <td>${rec ? cylinder(rec, 'cylm') : '–'}</td>
      <td class="rec">${rec ? ING.map((i) => `${i.short} ${rec[i.k]}`).join(' · ') : '–'}<br><span class="mute">100 mL: ${rec ? ING.map((i) => rec[i.k] * 5).join(' / ') : '–'}</span></td>
      <td class="big">${fmt1(x.inGroup)}</td><td class="big">${fmt1(x.tasting)}${win ? ' 🏆' : ''}</td>
      <td class="trend">${trend || '–'}</td><td>${esc(x.reason) || '<span class="mute">–</span>'}</td></tr>`;
  }).join('');
  return `<div class="hd"><h2>모둠별 <span class="r">결과</span></h2><span class="pill">20 mL 기준 레시피</span></div>
    <table class="rtable"><thead><tr><th>모둠</th><th>베스트</th><th>레시피 (mL)</th><th>모둠 내<br>종합 맛</th><th>시음회</th><th>시제품별 종합 맛</th><th>선정 이유</th></tr></thead><tbody>${rows}</tbody></table>`;
};

// 질문 던지기: 맛있다고 느낀 레시피들 사이에 공통점이 있을까?
R.measure = () => {
  const res = S.sess.results;
  const rows = groupKeys().map((g) => ({ g, ...(res?.groups?.[g] || {}) })).filter((x) => x.recipe)
    .sort((a, b) => (b.tasting ?? -1) - (a.tasting ?? -1));
  const cards = rows.map((x) => `<div class="mcard" style="--c:${gColor(x.g)}"><span class="gchip">${x.g}</span>${cylinder(x.recipe, 'cylm')}
      <span class="sc">${fmt1(x.tasting)}<small>시음회</small></span>
      <span class="rc">${ING.map((i) => `<i style="--c:${i.color}"></i>${i.short} <b>${x.recipe[i.k]}</b>`).join('<br>')}</span></div>`).join('');
  return `<div class="hd"><h2>맛있는 레시피들, <span class="r">공통점</span>이 있을까?</h2><span class="pill">시음회 점수 높은 순</span></div>
    <div class="mrow" style="grid-template-columns:repeat(${Math.max(rows.length, 1)},1fr)">${cards || '<p class="lead">결과가 아직 없어요.</p>'}</div>
    <div class="qs">
      <div class="box">🤔 점수가 높은 음료는 <b>오미자·알룰로스 양</b>이 비슷할까?</div>
      <div class="box">😋 ‘달다’, ‘시다’는 <b>사람마다</b> 다르게 느끼는데…</div>
    </div>
    <div class="ask">🔍 <b>정말 객관적으로</b> 맛을 나타내는 방법은 없을까?</div>`;
};

// 답: pH와 °Brix (다음 차시에 측정) + 마무리
R.wrap = () => `<div class="hd"><h2>더 <span class="r">객관적</span>으로: pH와 °Brix</h2><span class="pill">다음 차시에 측정해요</span></div>
  <div class="obj4">
    <div class="box"><b>당도 <span class="u">°Brix</span></b><p><b>굴절당도계</b>: 물에 녹아 있는 당이 많을수록 빛이 더 꺾여요</p></div>
    <div class="box"><b>pH</b><p><b>pH 미터</b>: 산의 세기. 숫자가 작을수록 더 강한 산성</p></div>
    <div class="box"><b>산도 <span class="u">%</span></b><p><b>산·염기 적정</b>: NaOH를 넣어 중화시키며 산이 얼마나 들었는지 구해요</p></div>
    <div class="box hot"><b>당산비</b><p><b>= 당도 ÷ 산도</b><br>단맛과 신맛의 <b>균형</b>을 숫자 하나로</p></div>
  </div>
  <div class="ask">🔍 우리 반 최우수 레시피의 <b>당산비</b>는 얼마일까? 점수가 높은 음료끼리 당산비도 비슷할까?</div>
  <div class="todo2"><span>🧪 남은 시료는 폐기</span><span>🧽 주사기·컵 씻어 정리</span><span>🧻 책상 닦기</span><span>👋 수고했어요!</span></div>`;

// ---------- 팝업 ----------
const recLine = (rec, syrup = '알룰로스') => [...ING.map((i) => [i.k === 'syrup' ? syrup : i.short, rec[i.k]]), ['사과즙', rec.apple]]
  .filter(([, v]) => v).map(([n, v]) => `${n} <b>${v}</b>`).join(' · ');
const POP = {
  rnd: () => `<span class="pill">실제 개발 사례 · 문경</span>
    <h3>문경 오미자로 만든 <span class="r">스파클링 음료</span></h3>
    <div class="case"><div>
      <p>문경의 양조장 <b>오미나라</b>가 문경 오미자로 개발한 <b>‘오미로제’</b>는 <b>2018 평창 동계올림픽 공식 건배주</b>로 쓰였어요.</p>
      <p>또 <b>문경시농업기술센터</b>와 함께 2015년부터 <b>5년 동안</b> 연구해, 값을 낮춘 보급형 제품을 2020년에 새로 내놓았어요.</p>
      <p class="loopline"><span>만들기</span>→<span>맛보기·평가</span>→<span>고치기</span>를 몇 년 동안 되풀이 = <b>R&amp;D(연구 개발)</b></p></div>
      <div class="tip">오늘 우리가 할 일도<br><b class="r">똑같아요!</b></div></div>
    <p class="src">출처: 한국경제(2020.5), 경향신문(2018.2) 보도</p>`,
  case: () => `<span class="pill">실제 사례 · 과일 품질</span>
    <h3>한라봉은 <span class="r">당도와 산도</span>를 함께 재요</h3>
    <div class="case"><div>
      <p>한라봉을 출하할 때는 맛을 숫자로 확인해요. 흔히 쓰는 상품 기준은</p>
      <div class="std"><span>당도 <b>12 °Brix</b> 이상</span><span>산 함량 <b>1.1 %</b> 이하</span></div>
      <p>서귀포시의 출하 전 품질검사(2023년산)에 합격한 만감류는 평균 <b>12.8 °Brix, 산 0.95 %</b> → 당산비 약 <b>13.5</b></p>
      <p>달기만 해도, 시기만 해도 안 돼요. <b>단맛과 신맛의 균형</b>을 숫자로 보는 거예요.</p></div>
      <div class="tip">우리 오미자 음료의<br>당산비는<br><b class="r">얼마일까?</b></div></div>
    <p class="src">출처: 경북매일(2021.1), 뉴스서울(서귀포시 품질검사) 보도 · 지역·단체마다 기준이 조금씩 달라요</p>`,
  compare: () => {
    const res = S.sess.results;
    const mine = (res?.winners || []).map((g) => ({ cls: `${cls()} (우리 반)`, date: today(), g, score: res.groups?.[g]?.tasting, recipe: res.groups?.[g]?.recipe, syrup: '알룰로스', me: true }))
      .filter((x) => x.recipe);
    const list = [...mine, ...(S.sess.compare || [])];
    const rows = list.map((x) => `<tr class="${x.me ? 'me' : ''}"><td class="c">${esc(x.cls)}<small>${esc(x.date)} · ${x.g}모둠</small></td>
      <td>${cylinder(x.recipe, 'cylm')}</td><td class="rec">${recLine(x.recipe, x.syrup)}</td><td class="big">${fmt1(x.score)}</td></tr>`).join('');
    return `<span class="pill">반 최우수 레시피 · 20 mL 기준</span>
      <h3>다른 반 <span class="r">베스트</span>와 비교해 보자</h3>
      ${list.length > 1 ? `<table class="ctable"><thead><tr><th>반</th><th></th><th>레시피 (mL)</th><th>시음 평균</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="lead">리모컨 → 진행 탭에서 비교할 반을 골라 주세요.</p>'}
      <p class="src">점수는 반마다 소믈리에가 달라서 그대로 비교하기는 어려워요. 레시피의 <b>비율</b>을 비교해 봐요.</p>`;
  },
};

// 그린 뒤 이벤트 연결
const AFTER = {
  group() {
    const el = stage.firstElementChild;
    const drawSeq = S.sess.drawSeq || 0;
    if (seenDraw === null) seenDraw = drawSeq;
    else if (drawSeq !== seenDraw) {
      // 새로 뽑았을 때: 1.8초 섞은 뒤 모둠으로 떨어뜨리기
      seenDraw = drawSeq;
      shuffling = true;
      lastHtml = '';
      render();
      setTimeout(() => {
        shuffling = false;
        dropAnim = true;
        lastHtml = '';
        render();
        dropAnim = false;
      }, 1800);
      return;
    }
    el.querySelector('[data-act="draw"]')?.addEventListener('click', async () => {
      if (S.sess.groupsConfirmed && !(await ask('이미 확정했어요. 다시 뽑을까요?<br>모둠이 모두 바뀌어요.', { ok: '다시 뽑기', danger: true }))) return;
      drawGroups(S).catch((e) => toast(e.message));
    });
    el.querySelector('[data-act="confirm"]')?.addEventListener('click', () => confirmGroups(S).then(() => toast('모둠을 확정했어요.')).catch((e) => toast(e.message)));
    el.querySelectorAll('.gcol .pcard').forEach((c) => c.addEventListener('click', (e) => {
      e.stopPropagation();
      const stu = c.dataset.stu;
      if (e.target.closest('[data-lead]')) {
        const g = groupKeys().find((k) => S.sess.groups[k].members.includes(stu));
        selected = null;
        setLeader(S, g, stu);
        return;
      }
      selected = selected === stu ? null : stu;
      lastHtml = '';
      render();
    }));
    el.querySelectorAll('.gcol .h').forEach((h) => h.addEventListener('click', () => {
      if (!selected) return;
      const stu = selected;
      selected = null;
      moveMember(S, stu, h.dataset.g);
    }));
  },
  reveal(fresh) {
    if (!fresh && stage.firstElementChild.dataset.done) return;
    const el = stage.firstElementChild;
    el.dataset.done = '1';
    const flips = [...el.querySelectorAll('.flip')];
    flips.forEach((f, i) => setTimeout(() => f.classList.add('on'), 1200 + i * 1400));
    setTimeout(() => el.querySelector('.winner')?.classList.add('on'), 1600 + flips.length * 1400);
  },
};

// ---------- 조작 ----------
async function go(delta) {
  if (!S) return;
  const res = await stepSlide(S, delta, (m) => ask(m, { ok: '네' }));
  if (res?.error) toast(res.error);
}

function overlay(title, url, note) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="in"><h3>${title}</h3><div class="qrbox">${qrSvg(url)}</div><p class="mute" style="font-size:13px;word-break:break-all">${note}</p></div>`;
  o.addEventListener('click', () => o.remove());
  document.body.append(o);
}
const closeOverlay = () => document.querySelector('.overlay')?.remove();
const actions = {
  prev: () => go(-1),
  next: () => go(1),
  qr: () => (document.querySelector('.overlay') ? closeOverlay() : overlay('학생 접속 QR', studentUrl(), '카메라로 찍고 학번을 골라요')),
  remote: () => (document.querySelector('.overlay') ? closeOverlay() : overlay('선생님 리모컨', pageUrl('remote.html', { s: sid }), '선생님 휴대폰으로 찍고 Google 로그인')),
  fs: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
};
$('#ctl').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (b) actions[b.dataset.a]();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea') || document.querySelector('.modal')) return;
  const k = e.key;
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); actions.next(); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); actions.prev(); }
  else if (k === 'q' || k === 'Q' || k === 'ㅂ') actions.qr();
  else if (k === 'r' || k === 'R' || k === 'ㄱ') actions.remote();
  else if (k === 'f' || k === 'F' || k === 'ㄹ') actions.fs();
  else if (k === 'p' || k === 'P' || k === 'ㅔ') {
    const sl = DECK[S?.sess?.slide || 0];
    if (sl?.pops) setPop(S, S.sess.pop || sl.pops[0][0]);
  } else if (k === 'Escape') {
    if (document.querySelector('.overlay')) closeOverlay();
    else if (S?.sess?.pop) setPop(S, S.sess.pop);
  }
});

start();
