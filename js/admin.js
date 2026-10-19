// 관리자 화면 (교사 노트북, 수업 전·후)
import {
  db, auth, whenAuth, isTeacherUser, teacherSignIn, logout, pageUrl,
  doc, collection, onSnapshot, getDocs, getDocsFromServer, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, query, where,
} from './fb.js';
import { $, $$, esc, ING, Q, classOf, classLabel, loadNames, saveNames, randomId, toast, ask, qrSvg, recipeOf } from './util.js';

const main = $('#main');
let classes = {};
let sessions = {};
let parsed = null;

async function start() {
  const u = await whenAuth();
  if (!(await isTeacherUser(u))) {
    main.innerHTML = `<div class="center"><div><h1 class="disp" style="font-size:40px;margin-bottom:10px">관리자</h1>
      <p class="mute" style="margin-bottom:18px">선생님 Google 계정으로 로그인해 주세요.</p>
      ${u && !u.isAnonymous ? `<p class="note r" style="margin-bottom:14px">${esc(u.email)} 은(는) 교사 계정이 아니에요.</p>` : ''}
      <button class="btn" id="login">Google로 로그인</button></div></div>`;
    $('#login').addEventListener('click', async () => {
      try {
        if (u) await logout();
        await teacherSignIn();
        start();
      } catch (e) { console.error(e); toast('로그인하지 못했어요.'); }
    });
    return;
  }
  onSnapshot(collection(db, 'classes'), (qs) => {
    classes = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()]));
    render();
  });
  onSnapshot(collection(db, 'sessions'), (qs) => {
    sessions = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()]));
    render();
  });
  render();
}

// ---------- 출석부 붙여넣기 ----------
// 엑셀에서 복사한 줄: "1301  김민수" / "1  1301  김민수" 등. 4자리 학번과 이름(한글·영문)을 찾는다.
function parseRoster(text) {
  const rows = [];
  const bad = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/(?:^|\D)(\d{4})(?!\d)/);
    if (!m) { bad.push(line); continue; }
    const stu = m[1];
    const name = (line.split(/[\t,]|\s{1,}/).find((t) => /[가-힣A-Za-z]/.test(t)) || '').trim();
    rows.push({ stu, name, cid: classOf(stu) });
  }
  const seen = new Set();
  const uniq = rows.filter((r) => (seen.has(r.stu) ? false : seen.add(r.stu)));
  return { rows: uniq.sort((a, b) => a.stu.localeCompare(b.stu)), bad };
}

function pasteHtml() {
  const p = parsed;
  let prev = '<p class="mute">왼쪽에 붙여 넣으면 여기에 미리 보기가 나와요.</p>';
  if (p) {
    const byClass = {};
    p.rows.forEach((r) => (byClass[r.cid] ||= []).push(r));
    prev = Object.entries(byClass).map(([cid, rs]) => `<p style="font-weight:800;margin:4px 0">${classLabel(cid)} · ${rs.length}명
      ${classes[cid] ? '<span class="mute">(기존 출석부를 바꿔요)</span>' : ''}</p>
      <table class="tbl"><tbody>${rs.map((r) => `<tr><td class="num">${r.stu}</td><td class="l">${esc(r.name) || '<span class="mute">이름 없음</span>'}</td></tr>`).join('')}</tbody></table>`).join('');
    if (p.bad.length) prev += `<p class="note r" style="margin-top:8px">학번을 찾지 못한 줄 ${p.bad.length}개는 건너뛰어요.</p>`;
  }
  return `<section class="box"><h2>출석부 붙여넣기</h2>
    <p class="mute" style="margin-bottom:12px">엑셀에서 <b>학번·이름</b> 열을 복사해 붙여 넣으세요. 반별로 하나씩 해도 되고 여러 반을 한 번에 해도 돼요.<br>
    <b>서버에는 학번만</b> 저장되고, 이름은 <b>이 브라우저에만</b> 저장돼요.</p>
    <div class="paste"><div><textarea id="paste" placeholder="1301	김민수&#10;1302	이서연&#10;…"></textarea></div>
      <div class="prev">${prev}</div></div>
    <div style="margin-top:12px;display:flex;gap:10px"><button class="btn" id="saveRoster" ${p?.rows.length ? '' : 'disabled'}>출석부 저장</button></div></section>`;
}

// ---------- 반 카드 ----------
const fmtDate = (ts) => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '방금';
};
const STAGE_NAME = { intro: '도입', join: '접속', grouping: '모둠 배치', brief: '개발 안내', develop: '개발', tasting: '시음회', reveal: '결과 공개', wrap: '정리' };

function classHtml(cid) {
  const c = classes[cid];
  const names = loadNames();
  const named = c.roster.filter((s) => names[s]).length;
  const ss = Object.entries(sessions).filter(([, s]) => s.classId === cid)
    .sort((a, b) => (b[1].createdAt?.seconds || 9e9) - (a[1].createdAt?.seconds || 9e9));
  const gc = c.groupCount || 5;
  return `<div class="box cls"><h3>${classLabel(cid)}<span class="pill">${c.roster.length}명</span></h3>
    <p class="meta">이 브라우저의 이름 ${named}/${c.roster.length}명 · 모둠당 약 ${Math.round(c.roster.length / gc * 10) / 10}명</p>
    <div class="ctrl">모둠 수 <select data-gc="${cid}">${[2, 3, 4, 5].map((n) => `<option ${n === gc ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn sm" data-open="${cid}">새 수업 열기</button></div>
    ${ss.map(([sid, s]) => `<div class="sess ${s.open ? 'open' : ''}"><div class="t"><span>${s.lesson}차시 · ${fmtDate(s.createdAt)}</span>
        <span class="mute">${s.open ? `진행 중 · ${STAGE_NAME[s.stage] || ''}` : '닫힘'}</span></div>
      <div class="acts">
        <a class="btn sm ink" href="${pageUrl('show.html', { s: sid })}" target="_blank">발표 화면</a>
        <button class="btn sm ghost" data-qr="remote:${sid}">리모컨 QR</button>
        <button class="btn sm ghost" data-qr="student:${sid}">학생 QR</button>
        <button class="btn sm ghost" data-toggle="${sid}">${s.open ? '닫기' : '다시 열기'}</button>
        <button class="btn sm ghost" data-del="${sid}">삭제</button></div></div>`).join('') || '<p class="mute">아직 연 수업이 없어요.</p>'}
    <div class="danger"><button class="btn sm yellow" data-xlsx="${cid}">엑셀 내보내기</button>
      <button class="btn sm ghost" data-wipe="${cid}">반 데이터 삭제</button></div></div>`;
}

function render() {
  const focus = document.activeElement?.id === 'paste';
  const pasteVal = $('#paste')?.value || '';
  const cids = Object.keys(classes).sort();
  main.innerHTML = `<header class="adm-head"><div><p class="mute" style="font-weight:700">과탐실2 · 오미자 음료 개발</p><h1>관리자</h1></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="mute">${esc(auth.currentUser?.email || '')}</span><button class="btn sm ghost" id="logout">로그아웃</button></div></header>
    ${pasteHtml()}
    <section><h2 style="margin-top:8px">반별 수업</h2>
      ${cids.length ? `<div class="classes">${cids.map(classHtml).join('')}</div>` : '<p class="mute">출석부를 먼저 붙여 넣어 주세요.</p>'}</section>
    <section class="box flat"><h2>순서 안내</h2>
      <ol style="padding-left:1.2em;line-height:1.9">
        <li><b>새 수업 열기</b> → 발표 화면이 새 탭으로 열려요. TV로 미러링하고 F 키로 전체 화면.</li>
        <li>휴대폰으로 <b>리모컨 QR</b>을 찍고 같은 Google 계정으로 로그인.</li>
        <li>발표 화면: → / ← / 스페이스 / 클리커로 넘기기 · Q 학생 QR · R 리모컨 QR.</li>
        <li>수업이 끝나면 리모컨 '마무리'에서 <b>수업 닫기</b>. 학기 말에 <b>엑셀 내보내기</b> 후 <b>반 데이터 삭제</b>.</li>
      </ol>
      <p class="mute" style="margin-top:10px">이름은 이 컴퓨터 브라우저에만 있어요. <button class="btn sm ghost" id="forget">이 브라우저의 이름 모두 지우기</button></p></section>`;
  const ta = $('#paste');
  ta.value = pasteVal;
  if (focus) ta.focus();
  bind();
}

function bind() {
  $('#logout').addEventListener('click', async () => { await logout(); location.reload(); });
  const ta = $('#paste');
  ta.addEventListener('input', () => {
    parsed = ta.value.trim() ? parseRoster(ta.value) : null;
    const pos = ta.selectionStart;
    render();
    $('#paste').setSelectionRange(pos, pos);
  });
  $('#saveRoster')?.addEventListener('click', saveRoster);
  $('#forget').addEventListener('click', async () => {
    if (!(await ask('이 브라우저에 저장된 이름을 모두 지울까요?', { ok: '지우기', danger: true }))) return;
    saveNames({});
    render();
  });
  $$('[data-gc]').forEach((s) => s.addEventListener('change', () => updateDoc(doc(db, 'classes', s.dataset.gc), { groupCount: Number(s.value) })));
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.open)));
  $$('[data-qr]').forEach((b) => b.addEventListener('click', () => {
    const [kind, sid] = b.dataset.qr.split(':');
    const url = kind === 'remote' ? pageUrl('remote.html', { s: sid }) : pageUrl('index.html', { s: sid });
    const m = document.createElement('div');
    m.className = 'modal qrm';
    m.innerHTML = `<div class="modal-box" style="text-align:center"><h2 class="disp" style="font-size:24px">${kind === 'remote' ? '선생님 리모컨' : '학생 접속'}</h2>
      <div class="qrbox">${qrSvg(url)}</div><p class="mute" style="font-size:12px;word-break:break-all">${esc(url)}</p>
      <div class="modal-btns"><button class="btn ghost" data-copy>주소 복사</button><button class="btn ink" data-x>닫기</button></div></div>`;
    m.addEventListener('click', (e) => {
      if (e.target.closest('[data-copy]')) navigator.clipboard.writeText(url).then(() => toast('복사했어요.'));
      if (e.target.closest('[data-x]') || e.target === m) m.remove();
    });
    document.body.append(m);
  }));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const sid = b.dataset.toggle;
    updateDoc(doc(db, 'sessions', sid), { open: !sessions[sid].open });
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ask('이 수업의 데이터를 모두 삭제할까요?<br>되돌릴 수 없어요.', { ok: '삭제', danger: true }))) return;
    try {
      toast('삭제하는 중…', 60000);
      await deleteSession(b.dataset.del);
      toast('삭제했어요.');
    } catch (e) {
      console.error(e);
      deleteFailed(e);
    }
  }));
  $$('[data-xlsx]').forEach((b) => b.addEventListener('click', () => exportClass(b.dataset.xlsx).catch((e) => { console.error(e); toast('내보내지 못했어요.'); })));
  $$('[data-wipe]').forEach((b) => b.addEventListener('click', () => wipeClass(b.dataset.wipe)));
}

async function saveRoster() {
  const byClass = {};
  parsed.rows.forEach((r) => (byClass[r.cid] ||= []).push(r));
  const list = Object.keys(byClass).map(classLabel).join(', ');
  if (!(await ask(`${list} 출석부를 저장할까요?<br>이미 있는 반은 새 출석부로 바뀌어요.<br><span class="mute">(이미 열린 수업에는 영향 없음)</span>`, { ok: '저장' }))) return;
  const names = loadNames();
  const b = writeBatch(db);
  for (const [cid, rs] of Object.entries(byClass)) {
    b.set(doc(db, 'classes', cid), { roster: rs.map((r) => r.stu), groupCount: classes[cid]?.groupCount || 5, updatedAt: serverTimestamp() });
    rs.forEach((r) => { if (r.name) names[r.stu] = r.name; });
  }
  await b.commit();
  saveNames(names);
  parsed = null;
  $('#paste').value = '';
  toast('출석부를 저장했어요.');
  render();
}

async function openSession(cid) {
  const c = classes[cid];
  const open = Object.values(sessions).filter((s) => s.classId === cid && s.open);
  if (open.length && !(await ask(`${classLabel(cid)}에 아직 열린 수업이 있어요.<br>새로 열까요?`, { ok: '새로 열기' }))) return;
  // 팝업 차단을 피하려고 탭을 먼저 연다
  const win = window.open('', '_blank');
  const sid = randomId(20);
  await setDoc(doc(db, 'sessions', sid), {
    classId: cid, lesson: 1, open: true, stage: 'intro', slide: 0,
    roster: c.roster, absent: [], groupCount: c.groupCount || 5,
    groups: {}, groupsConfirmed: false, drawSeq: 0, tasting: null, results: null,
    createdAt: serverTimestamp(),
  });
  const url = pageUrl('show.html', { s: sid });
  if (win) win.location = url;
  else location.href = url;
}

const SUBS = ['claims', 'devices', 'groups', 'ratings', 'summaries', 'tastes', 'private'];
async function deleteSession(sid) {
  // 수업 문서를 먼저 지워 열린 교사 화면이 더 이상 쓰지 못하게 한다
  const first = writeBatch(db);
  first.delete(doc(db, 'sessions', sid));
  await first.commit();
  for (const sub of SUBS) {
    const qs = await getDocsFromServer(collection(db, 'sessions', sid, sub));
    for (let i = 0; i < qs.docs.length; i += 400) {
      const b = writeBatch(db);
      qs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
}

function deleteFailed(e) {
  const denied = e?.code === 'permission-denied';
  ask(denied
    ? '삭제하지 못했어요.<br>Firebase 콘솔의 <b>보안 규칙이 최신인지</b> 확인해 주세요.'
    : `삭제하지 못했어요.<br>인터넷 연결을 확인하고 다시 눌러 주세요.<br><span class="mute">${esc(e?.code || e?.message || '')}</span>`, { ok: '확인', cancel: '' });
}

async function wipeClass(cid) {
  const ids = Object.entries(sessions).filter(([, s]) => s.classId === cid).map(([id]) => id);
  if (!(await ask(`${classLabel(cid)} 수업 데이터 ${ids.length}개를 모두 삭제할까요?<br><b>엑셀로 먼저 내보냈는지</b> 확인하세요. 되돌릴 수 없어요.`, { ok: '삭제', danger: true }))) return;
  const alsoRoster = await ask('출석부(학번 목록)도 삭제할까요?', { ok: '출석부도 삭제', cancel: '수업만 삭제' });
  try {
    for (const [i, id] of ids.entries()) {
      toast(`삭제하는 중… (${i + 1}/${ids.length})`, 60000);
      await deleteSession(id);
    }
    if (alsoRoster) {
      const b = writeBatch(db);
      b.delete(doc(db, 'classes', cid));
      await b.commit();
    }
    toast('삭제했어요.');
  } catch (e) {
    console.error(e);
    deleteFailed(e);
  }
}

// ---------- 엑셀 ----------
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.append(s);
  });
}

async function exportClass(cid) {
  toast('엑셀을 만드는 중…');
  const XLSX = await loadXlsx();
  const names = loadNames();
  const nm = (s) => names[s] || '';
  const qs = await getDocs(query(collection(db, 'sessions'), where('classId', '==', cid)));
  const R = { 평가: [], 레시피: [], 모둠: [], 시음회: [], 시음점수: [] };
  for (const sd of qs.docs) {
    const s = sd.data();
    const when = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString('ko-KR') : '';
    const base = { 수업: when, 차시: s.lesson };
    const [rat, grp, tas, blind] = await Promise.all([
      getDocs(collection(db, 'sessions', sd.id, 'ratings')),
      getDocs(collection(db, 'sessions', sd.id, 'groups')),
      getDocs(collection(db, 'sessions', sd.id, 'tastes')),
      getDoc(doc(db, 'sessions', sd.id, 'private', 'blind')),
    ]);
    rat.docs.map((d) => d.data()).sort((a, b) => a.g - b.g || a.r - b.r || a.stu.localeCompare(b.stu)).forEach((r) => {
      R.평가.push({ ...base, 모둠: Number(r.g), 시제품: r.r, 학번: r.stu, 이름: nm(r.stu), ...Object.fromEntries(Q.map((q) => [q.name, r[q.k]])), 대리평가: r.proxy ? '대리' : '' });
    });
    for (const gd of grp.docs) {
      const g = gd.id;
      const x = gd.data();
      for (const [r, rd] of Object.entries(x.rounds || {})) {
        const row = { ...base, 모둠: Number(g), 시제품: Number(r), 베스트: x.best === Number(r) ? '★' : '' };
        ING.forEach((i) => { row[`계획_${i.short}`] = rd.plan?.[i.k] ?? ''; });
        ING.forEach((i) => { row[`실제_${i.short}`] = recipeOf(rd)?.[i.k] ?? ''; });
        R.레시피.push(row);
      }
      const info = s.groups?.[g] || { members: [] };
      info.members.forEach((m) => R.모둠.push({
        ...base, 모둠: Number(g), 학번: m, 이름: nm(m), 모둠장: info.leader === m ? 'O' : '', 소믈리에: x.sommelier === m ? 'O' : '',
        결석: (s.absent || []).includes(m) ? 'O' : '', 선정이유: x.reason || '',
        예측_단맛: { more: '더 달다', same: '비슷', less: '덜 달다' }[x.predSweet] || '', 예측_신맛: { more: '더 시다', same: '비슷', less: '덜 시다' }[x.predSour] || '',
      }));
    }
    const map = blind.exists() ? blind.data().map : {};
    (s.results?.cups || []).forEach((c) => R.시음회.push({ ...base, 컵: c.cup, 모둠: Number(c.g), 평균: c.avg, 인원: c.n, 최우수: s.results.winners.includes(c.g) ? '★' : '' }));
    tas.docs.forEach((d) => {
      const t = d.data();
      Object.entries(t.scores || {}).forEach(([cup, v]) => R.시음점수.push({ ...base, 소믈리에: t.stu, 이름: nm(t.stu), 소믈리에_모둠: Number(t.g), 컵: cup, 컵_모둠: Number(map[cup]) || '', 점수: v }));
    });
  }
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(R)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '데이터 없음' }]), name);
  }
  XLSX.writeFile(wb, `오미자_${classLabel(cid).replace(/\s/g, '')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

start();
