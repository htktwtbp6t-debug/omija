// 교사 리모컨 (교사 휴대폰). TV에 비치면 안 되는 것은 여기서만 본다.
import { whenAuth, isTeacherUser, teacherSignIn, pageUrl } from './fb.js';
import { $, $$, esc, ING, gColor, loadNames, toast, ask, classLabel } from './util.js';
import {
  DECK, stageIdx, watchClass, goSlide, stepSlide, setPop, otherResults, setCompare, hashKey, setAbsent, unlock, drawGroups, confirmGroups, moveMember, setLeader,
  markMade, setSommelier, closeSession, reopenSession, groupStatus, setTimer, addTimer,
} from './teacher.js';

const main = $('#main');
const tabs = $('#tabs');
const sid = new URLSearchParams(location.search).get('s');
const names = loadNames();
let S = null;
let tab = 'go';
let lastStage = null;
let tasteMode = 'cup';
let others = null; // 다른 반 베스트 후보 (리모컨에서 처음 열 때 한 번 불러옴)

const STAGE_NAME = { intro: '도입', join: '접속', grouping: '모둠 배치', brief: '개발 안내', develop: '시제품 개발', tasting: '시음회', reveal: '결과 공개', wrap: '정리' };
const STAGE_TAB = { intro: 'go', join: 'att', grouping: 'grp', brief: 'go', develop: 'go', tasting: 'taste', reveal: 'go', wrap: 'end' };
const nm = (s) => (names[s] ? ` ${esc(names[s])}` : '');

async function start() {
  if (!sid) {
    main.innerHTML = '<div class="center"><div><h2 class="disp">수업 코드가 없어요</h2><p class="mute">관리자 화면의 리모컨 QR을 찍어 주세요.</p></div></div>';
    return;
  }
  const u = await whenAuth();
  if (!(await isTeacherUser(u))) {
    main.innerHTML = `<div class="center"><div><h2 class="disp" style="font-size:2rem;margin-bottom:10px">선생님 리모컨</h2>
      <p class="mute" style="margin-bottom:18px">선생님 Google 계정으로 로그인해 주세요.</p><button class="btn" id="login">Google로 로그인</button></div></div>`;
    $('#login').addEventListener('click', async () => {
      try {
        const v = await teacherSignIn();
        if (!(await isTeacherUser(v))) return toast('교사 계정이 아니에요.');
        // 카운트다운 숫자만 1초마다 갱신
setInterval(() => {
  const el = document.getElementById('tleft');
  const end = S?.sess?.timer?.end;
  if (!el || !end) return;
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  el.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '시간 끝';
}, 1000);

start();
      } catch (e) { console.error(e); toast('로그인하지 못했어요.'); }
    });
    return;
  }
  tabs.hidden = false;
  watchClass(sid, (st) => {
    if (st.error || !st.sess) {
      main.innerHTML = '<div class="center"><h2 class="disp">수업을 열 수 없어요</h2></div>';
      return;
    }
    S = st;
    if (S.sess.stage !== lastStage) {
      if (lastStage !== null) tab = STAGE_TAB[S.sess.stage] || tab;
      lastStage = S.sess.stage;
    }
    render();
  });
}

tabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

let pending = false;
function render(force = false) {
  if (!S) return;
  // 선택 상자를 고르는 중이면 잠깐 미뤘다가, 선택이 끝나거나 3초 뒤에는 무조건 다시 그린다 (아이폰은 선택 상자가 포커스를 계속 쥐고 있음)
  const act = document.activeElement;
  if (!force && act?.tagName === 'SELECT' && main.contains(act)) {
    if (!pending) {
      pending = true;
      const again = () => { if (!pending) return; pending = false; render(true); };
      act.addEventListener('blur', again, { once: true });
      setTimeout(again, 3000);
    }
    return;
  }
  pending = false;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const idx = S.sess.slide || 0;
  const head = `<div class="rm-head"><b>${classLabel(S.sess.classId)}</b>
    <span class="pill">${S.sess.open ? STAGE_NAME[S.sess.stage] : '닫힌 수업'}</span></div>
    ${tab === 'go' ? '' : `<div class="mini"><button data-nav="-1" aria-label="이전">‹</button>
      <span><b class="num">${idx + 1}/${DECK.length}</b> ${DECK[idx].title}${subTxt(DECK[idx])}</span><button data-nav="1" class="nx">다음 ›</button></div>`}`;
  main.innerHTML = head + ({ go: tabGo, att: tabAtt, grp: tabGrp, taste: tabTaste, end: tabEnd }[tab])();
  bind();
}

async function go(i) {
  const r = await goSlide(S, i, (m) => ask(m, { ok: '네' }));
  if (r?.error) toast(r.error);
}
async function step(d) {
  const r = await stepSlide(S, d, (m) => ask(m, { ok: '네' }));
  if (r?.error) toast(r.error);
}
const subTxt = (d) => (d.steps ? ` <span class="pill light">${S.sess.sub || d.steps}/${d.steps}</span>` : '');

// ---------- 진행 ----------
function tabGo() {
  const idx = S.sess.slide || 0;
  const cur = DECK[idx];
  const roster = S.sess.roster || [];
  const ab = new Set(S.sess.absent || []);
  const on = roster.filter((s) => S.claims[s]).length;
  let ctx = `<p class="mute" style="margin-bottom:6px">접속 <b>${on}</b> / ${roster.length - ab.size}명 · 결석 ${ab.size}명</p>`;
  if (S.sess.stage === 'develop') {
    ctx += Object.keys(S.sess.groups || {}).sort().map((g) => {
      const st = groupStatus(S, g);
      return `<div class="gst"><span class="gchip" style="--c:${gColor(g)}">${g}</span><span><b>${st.text}</b> <span class="mute">${st.sub}</span></span></div>`;
    }).join('');
  }
  const list = DECK.map((d, i) => {
    const locked = stageIdx(d.stage) > stageIdx(S.sess.stage) && i !== idx + 1;
    return `<button class="${i === idx ? 'cur' : ''}" data-slide="${i}" ${locked ? 'disabled style="opacity:.45"' : ''}>${i + 1}. ${d.title}</button>`;
  }).join('');
  const tm = S.sess.timer?.end;
  const left = tm ? Math.max(0, Math.ceil((tm - Date.now()) / 1000)) : 0;
  const timer = `<div class="sec"><h3>카운트다운 <span class="mute" style="font-weight:600">(TV 오른쪽 위)</span></h3>
    ${tm ? `<p style="font-weight:800;margin-bottom:6px"><span class="num" id="tleft">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span> 남음</p>` : '<p class="mute" style="margin-bottom:6px">꺼져 있어요</p>'}
    <div class="tbtns">${[3, 5, 7, 10].map((m) => `<button class="btn sm ghost" data-timer="${m * 60}">${m}분</button>`).join('')}
      ${tm ? '<button class="btn sm ghost" data-tadd="60">+1분</button><button class="btn sm ink" data-timer="0">끄기</button>' : ''}</div></div>`;
  const sub = S.sess.sub || cur.steps;
  const nextTxt = cur.steps && sub < cur.steps ? `다음: 항목 하나 더 보이기 (${sub}/${cur.steps})` : DECK[idx + 1] ? `다음: ${DECK[idx + 1].title}` : '';
  const pops = cur.pops ? `<div class="pops">${cur.pops.map(([k, n]) => `<button class="btn ${S.sess.pop === k ? 'ink' : 'ghost'}" data-pop="${k}">${S.sess.pop === k ? `${n} 닫기` : `TV에 띄우기: ${n}`}</button>`).join('')}</div>` : '';
  return `<div class="now"><p class="mute" style="font-weight:700">지금 TV · ${idx + 1} / ${DECK.length}</p><p class="t">${cur.title}${subTxt(cur)}</p>
      ${nextTxt ? `<p class="mute" style="margin-top:4px">${nextTxt}</p>` : ''}</div>
    <div class="nav"><button class="btn ghost" data-nav="-1">‹ 이전</button><button class="btn" data-nav="1">다음 ›</button></div>
    ${pops}${cur.id === 'result' ? compareSec() : ''}
    ${ctx}
    ${timer}
    <div class="sec"><h3>슬라이드 바로 가기</h3><div class="slist">${list}</div>
    <p class="mute" style="font-size:.85rem">아직 오지 않은 단계는 '다음'으로 차례대로 넘어가요.</p></div>`;
}

// 다른 반 베스트: 고른 반만 TV 팝업에 나온다
function compareSec() {
  if (!others) {
    others = 'loading';
    otherResults(S).then((v) => { others = v; render(); }).catch((e) => { console.error(e); others = []; render(); });
  }
  if (others === 'loading') return '<div class="sec"><h3>다른 반 베스트</h3><p class="mute">불러오는 중…</p></div>';
  const on = new Set((S.sess.compare || []).map((x) => x.id));
  return `<div class="sec"><h3>다른 반 베스트 <span class="mute" style="font-weight:600">(고른 반만 TV에)</span></h3>
    ${others.map((x) => `<label class="row ${on.has(hashKey(x.key)) ? 'on' : ''}"><span><input type="checkbox" data-cmp="${esc(x.key)}" ${on.has(hashKey(x.key)) ? 'checked' : ''}>
      ${esc(x.cls)} <span class="mute">${esc(x.date)} · ${x.g}모둠 · ${x.score ?? '–'}점</span></span></label>`).join('') || '<p class="mute">결과가 나온 다른 반이 아직 없어요.</p>'}</div>`;
}

// ---------- 출석 ----------
function tabAtt() {
  const roster = S.sess.roster || [];
  const ab = new Set(S.sess.absent || []);
  const off = roster.filter((s) => !S.claims[s]);
  const on = roster.filter((s) => S.claims[s]);
  return `<div class="sec"><h3>미접속 ${off.length}명 · 결석만 체크</h3>
    <p class="mute" style="margin-bottom:8px">출석했지만 기기가 없는 학생은 그대로 두세요 (모둠장이 대리 평가).</p>
    ${off.map((s) => `<div class="row ${ab.has(s) ? 'ab' : ''}"><span><span class="num">${s}</span>${nm(s)}</span>
      <button class="btn sm ${ab.has(s) ? 'ink' : 'ghost'}" data-absent="${s}">${ab.has(s) ? '결석 ✓' : '결석'}</button></div>`).join('') || '<p class="mute">모두 접속했어요.</p>'}
    <h3>접속 ${on.length}명</h3>
    ${on.map((s) => `<div class="row on"><span><span class="dot on"></span><span class="num">${s}</span>${nm(s)}</span>
      <button class="btn sm ghost" data-unlock="${s}">접속 해제</button></div>`).join('')}
    <p class="mute" style="font-size:.85rem;margin-top:8px">학생이 다른 기기에서 같은 학번을 고르면 그 기기로 저절로 옮겨져요. 접속 해제는 학번을 잘못 골랐을 때만 쓰세요.</p></div>`;
}

// ---------- 모둠 ----------
function tabGrp() {
  const gs = Object.keys(S.sess.groups || {}).sort();
  const confirmed = S.sess.groupsConfirmed;
  const opts = (cur) => gs.map((g) => `<option value="${g}" ${g === cur ? 'selected' : ''}>${g}모둠</option>`).join('');
  const blocks = gs.map((g) => {
    const grp = S.sess.groups[g];
    return `<h3><span class="gchip" style="--c:${gColor(g)};font-size:.9rem;vertical-align:middle">${g}</span> ${g}모둠 · ${grp.members.length}명</h3>
      ${grp.members.map((m) => `<div class="row ${grp.leader === m ? 'on' : ''}"><span><span class="dot ${S.claims[m] ? 'on' : ''}"></span><span class="num">${m}</span>${nm(m)}</span>
        <span style="display:flex;gap:6px;align-items:center">${grp.leader === m ? '<span class="pill">모둠장</span>' : `<button class="btn sm ghost" data-lead="${g}:${m}">모둠장</button>`}
        <select data-move="${m}">${opts(g)}</select></span></div>`).join('')}`;
  }).join('');
  return `<div class="sec">
    <p class="mute" style="margin:4px 0 10px">결석 체크를 먼저 하고 뽑으세요. 초록 점 = 접속한 학생 (모둠장은 접속한 학생 중에서 뽑아요).</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="btn ${gs.length ? 'ghost' : ''}" data-act="draw">${gs.length ? '다시 뽑기' : '모둠 뽑기'}</button>
      <button class="btn ${confirmed ? 'green' : 'ink'}" data-act="confirm" ${gs.length ? '' : 'disabled'}>${confirmed ? '확정됨 ✓' : '확정'}</button>
    </div>
    ${confirmed ? '<p class="mute" style="margin-top:8px;font-size:.85rem">확정 뒤에도 옮기기·모둠장 바꾸기가 바로 반영돼요. 지각생은 출석 탭에서 결석을 풀면 인원이 적은 모둠에 들어가요.</p>' : ''}
    ${blocks}</div>`;
}

// ---------- 시음 ----------
function tabTaste() {
  const t = S.sess.tasting;
  if (!t || !S.blind) {
    return `<div class="sec"><h3>시음회 전</h3><p class="mute">진행 탭에서 '시음회 준비' 슬라이드로 넘기면 컵 번호와 제조 레시피가 여기에 나와요.<br>TV에는 나오지 않아요.</p></div>`;
  }
  const cups = t.cups || [];
  const rec = S.blind.recipes || {};
  const made = S.blind.made || {};
  let body;
  if (tasteMode === 'cup') {
    body = cups.map((c) => `<div class="cupcard ${made[c] ? 'made' : ''}"><div style="display:flex;justify-content:space-between;align-items:center">
        <span class="cn">${c}</span><button class="btn sm ${made[c] ? 'green' : 'ghost'}" data-made="${c}">${made[c] ? '완료 ✓' : '만들었어요'}</button></div>
        <div class="ings">${ING.map((i) => `<span style="--c:${i.color}">${i.short}<b>${rec[c]?.[i.k] ?? 0}</b></span>`).join('')}</div>
        <p class="mute" style="font-size:.8rem">합계 ${ING.reduce((n, i) => n + (rec[c]?.[i.k] || 0), 0)} mL</p></div>`).join('');
  } else {
    body = ING.map((i) => `<div class="ingblock" style="--c:${i.color}"><div class="h">${i.name}</div><div class="b">
      ${cups.map((c) => `<span>${c}: ${rec[c]?.[i.k] ?? 0}</span>`).join('')}</div></div>`).join('');
  }
  const gs = Object.keys(S.sess.groups || {}).sort();
  const somm = gs.map((g) => {
    const gd = S.groups[g] || {};
    const mem = S.sess.groups[g].members;
    return `<div class="row"><span><span class="gchip" style="--c:${gColor(g)};font-size:.8rem;vertical-align:middle">${g}</span> 소믈리에</span>
      <select data-somm="${g}"><option value="">선택 안 됨</option>${mem.map((m) => `<option value="${m}" ${gd.sommelier === m ? 'selected' : ''}>${m}${names[m] ? ` ${esc(names[m])}` : ''}</option>`).join('')}</select></div>`;
  }).join('');
  return `<div class="sec"><h3>제조표 · 100 mL</h3>
    <p class="mute" style="margin-bottom:8px">어느 모둠 컵인지는 선생님에게도 보이지 않아요. 재료별 보기로 같은 주사기를 이어서 쓰면 빨라요.</p>
    <div class="seg"><button data-mode="cup" class="${tasteMode === 'cup' ? 'on' : ''}">컵별</button><button data-mode="ing" class="${tasteMode === 'ing' ? 'on' : ''}">재료별</button></div>
    ${body}
    <h3>소믈리에 (${t.phase === 'prep' ? '모둠장이 패드에서 정해요' : '시음 중'})</h3>
    <p class="mute" style="margin-bottom:8px;font-size:.85rem">모둠장이 못 정했을 때만 여기서 고르세요.</p>${somm}</div>`;
}

// ---------- 마무리 ----------
function tabEnd() {
  return `<div class="sec"><h3>수업 닫기</h3>
    <p class="mute" style="margin-bottom:10px">닫으면 학생 입력이 모두 잠기고 학생 화면에 '수고했어요'가 떠요. 데이터는 그대로 남아요.</p>
    ${S.sess.open ? '<button class="btn block" data-act="close">수업 닫기</button>' : '<button class="btn block ghost" data-act="reopen">다시 열기</button>'}
    <h3>발표 화면</h3><p class="mute">노트북에서 이 주소를 열면 같은 수업이 보여요.</p>
    <p style="word-break:break-all;font-size:.85rem;margin-top:6px">${esc(pageUrl('show.html', { s: sid }))}</p></div>`;
}

function bind() {
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.nav))));
  $$('[data-pop]').forEach((b) => b.addEventListener('click', () => setPop(S, b.dataset.pop).catch((e) => toast(e.message))));
  $$('[data-cmp]').forEach((c) => c.addEventListener('change', () => {
    const keys = new Set((S.sess.compare || []).map((x) => x.id));
    const id = hashKey(c.dataset.cmp);
    if (c.checked) keys.add(id); else keys.delete(id);
    setCompare(S, others.filter((x) => keys.has(hashKey(x.key)))).catch((e) => toast(e.message));
  }));
  $$('[data-slide]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.slide))));
  $$('[data-absent]').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.absent;
    setAbsent(S, s, !(S.sess.absent || []).includes(s)).catch((e) => toast(e.message));
  }));
  $$('[data-unlock]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ask(`${b.dataset.unlock} 접속을 해제할까요?`, { ok: '해제' }))) return;
    unlock(S, b.dataset.unlock).then(() => toast('접속을 해제했어요.')).catch((e) => toast(e.message));
  }));
  $$('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.act;
    try {
      if (a === 'draw') {
        if (S.sess.groupsConfirmed && !(await ask('이미 확정했어요. 다시 뽑을까요?<br>모둠이 모두 바뀌어요.', { ok: '다시 뽑기', danger: true }))) return;
        await drawGroups(S);
        if (DECK[S.sess.slide]?.id !== 'group') await go(DECK.findIndex((d) => d.id === 'group'));
      }
      if (a === 'confirm' && !S.sess.groupsConfirmed) { await confirmGroups(S); toast('모둠을 확정했어요.'); }
      if (a === 'close' && (await ask('수업을 닫을까요?', { ok: '닫기', danger: true }))) { await closeSession(S); toast('수업을 닫았어요.'); }
      if (a === 'reopen') { await reopenSession(sid); toast('다시 열었어요.'); }
    } catch (e) { console.error(e); toast(e.message); }
  }));
  $$('[data-lead]').forEach((b) => b.addEventListener('click', () => {
    const [g, m] = b.dataset.lead.split(':');
    setLeader(S, g, m);
  }));
  $$('[data-move]').forEach((sel) => sel.addEventListener('change', () => {
    moveMember(S, sel.dataset.move, sel.value);
    sel.blur();
  }));
  $$('[data-timer]').forEach((b) => b.addEventListener('click', () => setTimer(S, Number(b.dataset.timer)).catch((e) => toast(e.message))));
  $$('[data-tadd]').forEach((b) => b.addEventListener('click', () => addTimer(S, Number(b.dataset.tadd)).catch((e) => toast(e.message))));
  $$('[data-made]').forEach((b) => b.addEventListener('click', () => markMade(S, b.dataset.made, !S.blind.made?.[b.dataset.made])));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { tasteMode = b.dataset.mode; render(); }));
  $$('[data-somm]').forEach((sel) => sel.addEventListener('change', () => {
    if (sel.value) setSommelier(S, sel.dataset.somm, sel.value);
    sel.blur();
  }));
}

// 카운트다운 숫자만 1초마다 갱신
setInterval(() => {
  const el = document.getElementById('tleft');
  const end = S?.sess?.timer?.end;
  if (!el || !end) return;
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  el.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '시간 끝';
}, 1000);

start();
