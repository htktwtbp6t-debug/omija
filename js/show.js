// 발표 화면 (교사 노트북 → TV)
import { whenAuth, isTeacherUser, teacherSignIn, pageUrl } from './fb.js';
import { $, esc, ING, MAX_ROUNDS, gColor, cylinder, qrSvg, loadNames, fmt1, toast, ask, classLabel } from './util.js';
import {
  DECK, watchClass, goSlide, drawGroups, confirmGroups, moveMember, setLeader, groupStatus,
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

// ---------- 그리기 ----------
const R = {};
function render() {
  const idx = S.sess.slide || 0;
  const sl = DECK[idx];
  let html = (R[sl.id] || (() => ''))();
  html += `<div class="pager">${idx + 1} / ${DECK.length}</div>`;
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
    <div class="loop"><span class="k">오늘 · 레시피 찾기</span><em>→</em><span>다음 · 당도·산도 정량 분석</span><em>→</em><span>맛있는 음료의 데이터</span></div>
  </div>
  <div class="rc">${cylinder({ omija: 8, syrup: 4, apple: 4, pear: 1, water: 3 })}<div class="badge">오미자<small>다섯 가지 맛</small></div></div>
  <div class="marq"><div>${'<span>안전</span><span class="s">✦</span><span>손 씻기</span><span class="s">✦</span><span>정직한 기록</span><span class="s">✦</span><span>모둠 레시피는 하나</span><span class="s">✦</span><span>협력</span><span class="s">✦</span>'.repeat(2)}</div></div>`;

R.process = () => `<div class="hd"><h2>탐구의 <span class="r">큰 그림</span></h2><span class="pill">오늘은 1단계</span></div>
  <div class="road">
    <div class="box now"><span class="tag">오늘 · 1차시</span><b>맛있는 레시피 찾기</b><p>사람의 감각으로 평가 (관능평가)</p>
      <div class="mini"><span>만들기</span><em>→</em><span>맛 평가</span><em>→</em><span>고치기</span><em>↺ 3번까지</em></div>
      <div class="mini"><span>반 대표 블라인드 시음회</span></div></div>
    <em>→</em>
    <div class="box"><span class="tag">다음 · 2차시</span><b>정량 분석</b><p>측정값으로 평가</p>
      <div class="mini"><span>단맛 → 굴절당도계 (°Brix)</span></div><div class="mini"><span>신맛 → 산·염기 적정 (NaOH)</span></div></div>
    <em>→</em>
    <div class="box end"><b>맛있는 음료의<br>데이터</b><p>얼마나 달고<br>얼마나 실까?</p></div>
  </div>
  <p class="lead" style="text-align:center;margin-top:3cqi">분석하려면 먼저 <b>‘맛있는 음료’</b>라는 시료가 있어야겠죠? 오늘은 <b class="r">그 레시피를 찾는 날</b>이에요.</p>`;

R.omija = () => `<div class="hd"><h2>우리 동네 특산품 <span class="r">오미자</span>로<br>음료를 만들어 보자</h2></div>
  <p class="lead">오미자(五味子)는 다섯 가지 맛이 난다는 열매예요.</p>
  <div class="tastes5"><span style="background:var(--g2)">단맛</span><span style="background:var(--g3)">신맛</span><span>쓴맛</span><span>짠맛</span><span style="background:var(--g1);color:#fff">매운맛</span></div>
  <div class="goal">
    <div class="box"><b>오늘의 목표</b>만들고 → 평가하고 → 고쳐서<br>우리 반이 고른 <span class="hl">가장 맛있는 레시피</span>를 찾는다.</div>
    <div class="box" style="background:#ECE5FF"><b>다음 차시</b>그 레시피의 <span class="hl">당도와 산도</span>를<br>측정해 데이터로 남긴다.</div>
  </div>`;

R.promise = () => `<div class="hd"><h2>오늘의 약속</h2></div>
  <div class="promise">
    <div class="box"><div class="ic">🧤</div><b>안전</b><p>실험 도구는 정해진 용도로만.<br>맛보기 전에 손 씻기.</p></div>
    <div class="box" style="background:#FFF4D6"><div class="ic">📏</div><b>정직한 기록</b><p>넣은 양 그대로 입력.<br>내 입맛대로 솔직하게 평가.</p></div>
    <div class="box" style="background:#E7F8F0"><div class="ic">🤝</div><b>협력</b><p>배합은 모둠이 함께 정하고<br>한 컵을 같이 만든다.</p></div>
  </div>
  <div class="mini-note"><span>손 씻기</span><span>알레르기 있는 사람은 미리 말하기</span><span>시음은 한 모금씩</span></div>`;

const studentUrl = () => pageUrl('index.html', { s: sid });
R.join = () => {
  const ro = S.sess.roster || [];
  const ab = new Set(S.sess.absent || []);
  const on = ro.filter((s) => S.claims[s]).length;
  return `<div class="hd"><h2>QR로 <span class="r">접속</span>하기</h2><span class="pill">${cls()}</span></div>
  <div class="join"><div class="qrbox">${qrSvg(studentUrl())}</div>
    <div><p class="lead">카메라로 QR을 찍고 <b>내 학번</b>을 골라요.<br>한 번 고르면 그 기기는 그 학번으로 잠겨요.</p>
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

R.rules = () => `<div class="hd"><h2>재료와 <span class="r">규칙</span></h2><span class="pill">한 컵 = 20 mL</span></div>
  <div class="ings">${ING.map((i) => `<div class="box flat" style="--c:${i.color}"><span class="sw"></span>${i.name}</div>`).join('')}</div>
  <div class="rules"><ul>
      <li>1 mL 단위로, 합계 <b>20 mL</b></li>
      <li>재료마다 <b>주사기를 따로</b> 써요</li>
      <li>탄산수는 쓰지 않아요</li>
      <li>넣은 양이 다르면 <b>실제 값으로 고쳐요</b></li>
      <li>맛보기는 한 모금, 컵 사이에 물로 입 헹구기</li>
    </ul>
    <div><div class="shout" style="background:var(--g2)">시제품은 최대 3번!<small>만들고 → 평가하고 → 고쳐서 다시</small></div>
      <div class="shout" style="background:var(--g5)">모둠 레시피는 하나<small>모둠이 같이 정한 배합으로 한 컵만 만들어요</small></div></div></div>`;

R.steps = () => `<div class="hd"><h2>한 번 만들 때 <span class="r">5분</span></h2><span class="pill">모둠장 화면이 단계별로 안내해요</span></div>
  <div class="steps4">
    <div class="box"><span class="no">1</span><b>배합 정하기</b><p>모둠이 같이 의논해서<br>재료 5가지 양을 정해요.<br>합계 20 mL.</p></div>
    <div class="box"><span class="no">2</span><b>계량해 만들기</b><p>모둠장 화면을 보며<br>넣을 때마다 체크.<br>컵에 라벨 붙이기.</p></div>
    <div class="box"><span class="no">3</span><b>맛 평가</b><p>각자 폰으로<br>단맛·신맛·향·색·종합 맛<br>1~5점.</p></div>
    <div class="box"><span class="no">4</span><b>다음 배합 결정</b><p>모둠 평균을 보고<br>더 맛있게 고칠 점을<br>이야기해요.</p></div>
  </div>`;

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
      else if (r === gd?.round && gd.step === 'make') f = Math.round((Object.values(rd?.checked || {}).filter(Boolean).length / 5) * 100);
      return `<span class="cup ${r === gd?.round && !fin ? 'now' : ''}" style="--f:${f}%"></span>`;
    }).join('');
    const proxy = new Set(S.summaries[g]?.rounds?.[st.r]?.proxy || []);
    const pips = gd?.step === 'rate' || gd?.step === 'decide' || fin
      ? st.present.map((m) => `<i class="${proxy.has(m) ? 'px' : st.done.includes(m) || fin ? 'on' : ''}"></i>`).join('')
      : st.present.map(() => '<i></i>').join('');
    return `<div class="card ${fin ? 'fin' : ''}" style="--c:${gColor(g)}"><div class="h">${g}<small>모둠</small></div>
      <div class="b"><div class="cups">${cups}</div><div class="st">${st.text}<small>${st.sub}</small></div><div class="pips">${pips}</div></div></div>`;
  }).join('');
  return `<div class="hd"><h2>개발 현황</h2><span class="pill">최대 3번 · 점수는 시음회 뒤에</span></div>
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
      <div class="box"><b>1. 소믈리에 1명</b>모둠에서 정해 모둠장 화면에서 골라요.</div>
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

R.wrap = () => `<div class="wrap-s"><div>
    <span class="pill">다음 차시</span>
    <h1 style="margin-top:2cqi">오늘 찾은 레시피,<br><span class="r">얼마나 달고</span><br><span class="r">얼마나 신지</span><br>숫자로 재 보자</h1></div>
    <div class="todo"><span>🧪 남은 시료는 폐기</span><span>🧽 주사기·컵 씻어 정리</span><span>🧻 책상 닦기</span><span>👋 수고했어요!</span></div></div>`;

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
  const res = await goSlide(S, (S.sess.slide || 0) + delta, (m) => ask(m, { ok: '네' }));
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
  else if (k === 'Escape') closeOverlay();
});

start();
