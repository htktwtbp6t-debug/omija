// 교사 기기(발표 화면·리모컨) 공통: 수업 구독, 진행, 모둠 배치, 집계, 시음회, 결과
import {
  db, doc, collection, onSnapshot, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  serverTimestamp, arrayUnion, arrayRemove, increment, deleteField,
} from './fb.js';
import { ING, Q, DECK, shuffle, avg, recipeOf, classLabel } from './util.js';

export const STAGES = ['intro', 'join', 'grouping', 'brief', 'develop', 'tasting', 'reveal', 'wrap'];
export const stageIdx = (s) => STAGES.indexOf(s);

export { DECK };

const sref = (sid, ...p) => (p.length ? doc(db, 'sessions', sid, ...p) : doc(db, 'sessions', sid));
const scol = (sid, name) => collection(db, 'sessions', sid, name);

// ---------- 구독 ----------
// 교사 화면이 쓰는 모든 데이터를 모아 onChange로 알려 준다.
export function watchClass(sid, onChange, { aggregate = true } = {}) {
  const S = { sid, sess: null, claims: {}, groups: {}, summaries: {}, tastes: {}, blind: null, ratings: [] };
  const offs = [];
  const fire = () => S.sess && onChange(S);
  offs.push(onSnapshot(sref(sid), { includeMetadataChanges: true }, (d) => {
    if (!d.exists() && d.metadata.fromCache) return; // 서버 확인 전에는 '없음'으로 보지 않음
    S.sess = d.exists() ? d.data() : null;
    if (!S.sess) onChange(S); else fire();
  },
    (e) => { console.error(e); onChange({ ...S, error: e }); }));
  offs.push(onSnapshot(scol(sid, 'claims'), (qs) => { S.claims = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); fire(); }));
  offs.push(onSnapshot(scol(sid, 'groups'), (qs) => { S.groups = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); fire(); }));
  offs.push(onSnapshot(scol(sid, 'summaries'), (qs) => { S.summaries = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); fire(); aggregate && writeSummaries(S); }));
  offs.push(onSnapshot(scol(sid, 'tastes'), (qs) => { S.tastes = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); fire(); }));
  offs.push(onSnapshot(sref(sid, 'private', 'blind'), (d) => { S.blind = d.exists() ? d.data() : null; fire(); }));
  if (aggregate) {
    offs.push(onSnapshot(scol(sid, 'ratings'), (qs) => {
      S.ratings = qs.docs.map((d) => d.data());
      writeSummaries(S);
      fire();
    }));
  }
  return { S, stop: () => offs.forEach((f) => f()) };
}

// 개인 평가 → 모둠 평균. 교사 기기만 개인 점수를 읽을 수 있으므로 여기서 계산해 summaries에 쓴다.
export function buildSummaries(ratings) {
  const out = {};
  for (const r of ratings) {
    const g = (out[r.g] ||= { rounds: {} });
    const rd = (g.rounds[r.r] ||= { list: [] });
    rd.list.push(r);
  }
  for (const g of Object.values(out)) {
    for (const [k, rd] of Object.entries(g.rounds)) {
      const a = {};
      for (const q of Q) a[q.k] = Math.round(avg(rd.list.map((x) => x[q.k])) * 100) / 100;
      g.rounds[k] = { n: rd.list.length, done: rd.list.map((x) => x.stu).sort(), proxy: rd.list.filter((x) => x.proxy).map((x) => x.stu).sort(), avg: a };
    }
  }
  return out;
}
const deepCanon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const lastWritten = {};
function writeSummaries(S) {
  if (!S.sess || !S.sess.open) return; // 닫혔거나 삭제된 수업에는 쓰지 않음
  const built = buildSummaries(S.ratings);
  for (const [g, data] of Object.entries(built)) {
    const cur = S.summaries[g] ? { rounds: S.summaries[g].rounds } : null;
    const key = deepCanon(data);
    if (cur && deepCanon(cur) === key) continue;
    if (lastWritten[`${S.sid}/${g}`] === key) continue;
    lastWritten[`${S.sid}/${g}`] = key;
    setDoc(sref(S.sid, 'summaries', g), data).catch((e) => console.error('summary', e));
  }
}

// ---------- 진행 ----------
// 슬라이드 이동. 앞으로 갈 때만 단계가 바뀌고, 필요한 준비(시음회 컵 배정, 결과 계산)를 한다.
// fromEnd: 뒤로 와서 들어가면 단계별 항목을 모두 보인 채로 연다
export async function goSlide(S, idx, confirmFn, fromEnd = false) {
  const sess = S.sess;
  idx = Math.max(0, Math.min(DECK.length - 1, idx));
  const target = DECK[idx];
  const upd = { slide: idx, sub: target.steps ? (fromEnd ? target.steps : 1) : null, pop: null };
  const cur = stageIdx(sess.stage);
  const tgt = stageIdx(target.stage);
  if (tgt > cur) {
    if (tgt >= stageIdx('develop') && !sess.groupsConfirmed) {
      return { error: '먼저 모둠 배치를 확정해 주세요.' };
    }
    if (target.stage === 'tasting' && !sess.tasting) {
      if (confirmFn && !(await confirmFn('시음회를 시작할까요?<br>모든 모둠의 개발이 마감되고 컵 번호가 정해져요.'))) return { cancel: true };
      await setupTasting(S);
    }
    if (target.stage === 'reveal' && !sess.results) {
      if (confirmFn && !(await confirmFn('결과를 공개할까요?<br>시음 점수 입력이 마감돼요.'))) return { cancel: true };
      await computeResults(S);
    }
    upd.stage = target.stage;
  }
  if (target.stage === 'tasting' && target.phase === 'open') {
    const ph = S.sess.tasting?.phase || 'prep';
    if (ph === 'prep') upd['tasting.phase'] = 'open';
  }
  await updateDoc(sref(S.sid), upd);
  return { ok: true };
}

// 다음/이전. 단계별 항목이 있는 슬라이드는 항목을 하나씩 보이고 숨긴 뒤에 슬라이드를 넘긴다
export async function stepSlide(S, delta, confirmFn) {
  const idx = S.sess.slide || 0;
  const d = DECK[idx];
  const sub = S.sess.sub || d.steps || 0;
  if (d.steps && delta > 0 && sub < d.steps) return updateDoc(sref(S.sid), { sub: sub + 1 });
  if (d.steps && delta < 0 && sub > 1) return updateDoc(sref(S.sid), { sub: sub - 1 });
  return goSlide(S, idx + delta, confirmFn, delta < 0);
}

// 팝업 (발표 화면 위에 띄우는 사례·다른 반 베스트). 같은 것을 다시 누르면 닫힘
export async function setPop(S, k) {
  await updateDoc(sref(S.sid), { pop: S.sess.pop === k ? null : k });
}

// ---------- 반별 비교 (반별 최고 레시피 · 같은 컵 다른 점수) ----------
// 교사 화면이 서버에서 직접 읽어 메모리에만 둔다. 학생이 읽는 수업 문서에는 복사하지 않는다
export async function classData(S) {
  const qs = await getDocs(collection(db, 'sessions'));
  const lesson = S.sess.lesson || 1;
  const pick = {};
  qs.forEach((d) => {
    const s = d.data();
    if (!s.classId || !s.groupsConfirmed || (s.lesson || 1) !== lesson) return;
    if (s.classId === S.sess.classId && d.id !== S.sid) return;
    const at = s.createdAt?.toDate ? s.createdAt.toDate() : null;
    const c = { id: d.id, s, at, rank: s.results ? 1 : 0 };
    const o = pick[s.classId];
    if (!o || c.rank > o.rank || (c.rank === o.rank && (c.at || 0) > (o.at || 0))) pick[s.classId] = c;
  });
  const classes = [];
  let cups = [];
  await Promise.all(Object.entries(pick).map(async ([cid, { id, s, at }]) => {
    const me = id === S.sid;
    const [grp, tas] = await Promise.all([
      getDocs(collection(db, 'sessions', id, 'groups')),
      me ? getDocs(collection(db, 'sessions', id, 'tastes')) : null,
    ]);
    const res = s.results;
    const gl = [];
    grp.forEach((d) => {
      const x = d.data();
      const recipe = recipeOf(x.rounds?.[x.best]) || res?.groups?.[d.id]?.recipe;
      if (recipe) gl.push({ g: d.id, recipe, score: res?.groups?.[d.id]?.tasting ?? null });
    });
    if (!gl.length) return;
    gl.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const top = res?.groups?.[res.winners?.[0]];
    const mean = Object.fromEntries(ING.map((i) => [i.k, avg(gl.map((g) => g.recipe[i.k] || 0))]));
    classes.push({
      id: cid, label: classLabel(cid), me, noBest: !top?.recipe, recipe: top?.recipe || mean,
      date: at ? `${at.getMonth() + 1}/${at.getDate()}` : '', syrup: at && at < new Date(2026, 10, 4) ? '설탕 시럽' : '알룰로스',
      groups: gl,
    });
    if (me) {
      const tastes = tas.docs.map((d) => d.data());
      cups = (res?.cups || []).map((c) => ({ cup: c.cup, g: c.g, scores: tastes.map((t) => t.scores?.[c.cup]).filter((v) => typeof v === 'number') }));
    }
  }));
  classes.sort((a, b) => a.id.localeCompare(b.id));
  return { classes, cups };
}

// 화면 상태만 수업 문서에 둔다 (TV·리모컨이 같이 움직이게). 반 이름 외의 자료는 넣지 않는다
export const setView = (S, patch) => updateDoc(sref(S.sid), Object.fromEntries(Object.entries(patch).map(([k, v]) => [`view.${k}`, v])));
export function viewAct(S, ds) {
  const v = S.sess.view || {};
  const all = (v.list || []).map((x) => x.id);
  if ('vall' in ds) return setView(S, { open: (v.open || []).length === all.length ? [] : all });
  const open = new Set(v.open || []);
  if (open.has(ds.vopen)) open.delete(ds.vopen); else open.add(ds.vopen);
  return setView(S, { open: [...open] });
}

// ---------- 출석·잠금 ----------
export async function setAbsent(S, stu, on) {
  const sess = S.sess;
  const groups = structuredClone(sess.groups || {});
  if (on) {
    for (const g of Object.values(groups)) {
      g.members = g.members.filter((m) => m !== stu);
      if (g.leader === stu) g.leader = pickLeader(g.members, S.claims);
    }
    await updateDoc(sref(S.sid), { absent: arrayUnion(stu), groups });
  } else {
    const keys = Object.keys(groups);
    if (keys.length && !keys.some((k) => groups[k].members.includes(stu))) {
      const small = keys.sort((a, b) => groups[a].members.length - groups[b].members.length || a - b)[0];
      groups[small].members.push(stu);
      if (!groups[small].leader) groups[small].leader = stu;
    }
    await updateDoc(sref(S.sid), { absent: arrayRemove(stu), groups });
  }
}

export async function unlock(S, stu) {
  const c = S.claims[stu];
  const b = writeBatch(db);
  b.delete(sref(S.sid, 'claims', stu));
  if (c?.uid) b.delete(sref(S.sid, 'devices', c.uid));
  await b.commit();
}

// ---------- 모둠 ----------
function pickLeader(members, claims) {
  const online = members.filter((m) => claims[m]);
  const pool = online.length ? online : members;
  return pool.length ? shuffle(pool)[0] : null;
}

export async function drawGroups(S) {
  const sess = S.sess;
  const absent = new Set(sess.absent || []);
  const present = sess.roster.filter((s) => !absent.has(s));
  const k = Math.max(1, Math.min(sess.groupCount || 5, 5, present.length));
  // 접속한 학생을 먼저 돌려 나눠서, 모둠마다 기기가 있는 학생이 고르게 들어가게 한다
  const online = shuffle(present.filter((s) => S.claims[s]));
  const offline = shuffle(present.filter((s) => !S.claims[s]));
  const order = [...online, ...offline];
  const start = Math.floor(Math.random() * k);
  const groups = {};
  for (let i = 1; i <= k; i++) groups[i] = { members: [], leader: null };
  order.forEach((s, i) => groups[((i + start) % k) + 1].members.push(s));
  for (const g of Object.values(groups)) {
    g.leader = pickLeader(g.members, S.claims);
    g.members.sort();
  }
  await updateDoc(sref(S.sid), { groups, groupsConfirmed: false, drawSeq: increment(1) });
}

export async function moveMember(S, stu, toG) {
  const groups = structuredClone(S.sess.groups || {});
  for (const g of Object.values(groups)) {
    if (!g.members.includes(stu)) continue;
    g.members = g.members.filter((m) => m !== stu);
    if (g.leader === stu) g.leader = pickLeader(g.members, S.claims);
  }
  groups[toG] ||= { members: [], leader: null };
  groups[toG].members.push(stu);
  groups[toG].members.sort();
  if (!groups[toG].leader) groups[toG].leader = stu;
  await updateDoc(sref(S.sid), { groups });
}

export async function setLeader(S, g, stu) {
  await updateDoc(sref(S.sid), { [`groups.${g}.leader`]: stu });
}

export async function confirmGroups(S) {
  const b = writeBatch(db);
  for (const g of Object.keys(S.sess.groups || {})) {
    if (S.groups[g]) continue;
    b.set(sref(S.sid, 'groups', g), {
      round: 1, step: 'prep', rounds: {}, best: null, reason: '', predSweet: null, predSour: null, sommelier: null,
      updatedAt: serverTimestamp(),
    });
  }
  b.update(sref(S.sid), { groupsConfirmed: true, stage: stageIdx(S.sess.stage) < stageIdx('grouping') ? 'grouping' : S.sess.stage });
  await b.commit();
}

// ---------- 시음회 ----------
export function bestOf(gd, summ) {
  if (!gd) return null;
  if (gd.best) return gd.best;
  let best = null;
  let top = -1;
  for (const [r, s] of Object.entries(summ?.rounds || {})) {
    const v = s?.avg?.overall;
    if (v != null && v > top && recipeOf(gd.rounds?.[r])) { top = v; best = Number(r); }
  }
  if (best) return best;
  // 평가가 없으면 실제로 만든 마지막 시제품, 그것도 없으면 마지막 배합
  for (let r = gd.round; r >= 1; r--) if (gd.rounds?.[r]?.actual) return r;
  for (let r = gd.round; r >= 1; r--) if (gd.rounds?.[r]?.plan) return r;
  return null;
}

export async function setupTasting(S) {
  const sess = S.sess;
  const gs = Object.keys(sess.groups || {}).sort();
  const entries = [];
  for (const g of gs) {
    const gd = S.groups[g];
    const best = bestOf(gd, S.summaries[g]);
    const rec = best && recipeOf(gd.rounds[best]);
    if (rec) entries.push({ g, best, rec });
  }
  // 컵 번호는 1번부터. 어느 모둠이 몇 번인지는 무작위
  const nums = entries.map((_, i) => String(i + 1));
  const cups = shuffle(nums);
  const map = {};
  const recipes = {};
  entries.forEach((e, i) => {
    map[cups[i]] = e.g;
    recipes[cups[i]] = Object.fromEntries(ING.map((x) => [x.k, (Number(e.rec[x.k]) || 0) * 5]));
  });
  const b = writeBatch(db);
  b.set(sref(S.sid, 'private', 'blind'), { map, recipes, made: {}, at: serverTimestamp() });
  for (const e of entries) b.update(sref(S.sid, 'groups', e.g), { best: e.best, step: 'done' });
  b.update(sref(S.sid), { stage: 'tasting', tasting: { phase: 'prep', cups: nums } });
  await b.commit();
}

export async function markMade(S, cup, on) {
  await updateDoc(sref(S.sid, 'private', 'blind'), { [`made.${cup}`]: on ? true : deleteField() });
}

export async function setSommelier(S, g, stu) {
  await updateDoc(sref(S.sid, 'groups', g), { sommelier: stu });
}

export async function computeResults(S) {
  const sess = S.sess;
  const [blindSnap, tasteSnap] = await Promise.all([getDoc(sref(S.sid, 'private', 'blind')), getDocs(scol(S.sid, 'tastes'))]);
  const map = blindSnap.exists() ? blindSnap.data().map : {};
  const tastes = tasteSnap.docs.map((d) => d.data());
  const cups = (sess.tasting?.cups || []).map((cup) => {
    const scores = tastes.map((t) => t.scores?.[cup]).filter((v) => typeof v === 'number');
    const a = avg(scores);
    return { cup, g: map[cup] || null, avg: a == null ? null : Math.round(a * 100) / 100, n: scores.length };
  });
  const top = Math.max(-1, ...cups.map((c) => c.avg ?? -1));
  const winners = top >= 0 ? cups.filter((c) => c.avg === top).map((c) => c.g) : [];
  const groups = {};
  for (const g of Object.keys(sess.groups || {})) {
    const gd = S.groups[g] || {};
    const summ = S.summaries[g] || {};
    const best = gd.best || bestOf(gd, summ);
    const c = cups.find((x) => x.g === g);
    const rounds = {};
    for (let r = 1; r <= (gd.round || 0); r++) {
      if (recipeOf(gd.rounds?.[r])) rounds[r] = summ.rounds?.[r]?.avg?.overall ?? null;
    }
    groups[g] = {
      best: best || null,
      recipe: best ? recipeOf(gd.rounds?.[best]) : null,
      inGroup: best ? summ.rounds?.[best]?.avg?.overall ?? null : null,
      tasting: c?.avg ?? null,
      cup: c?.cup || null,
      rounds,
      reason: gd.reason || '',
      predSweet: gd.predSweet || null,
      predSour: gd.predSour || null,
    };
  }
  await updateDoc(sref(S.sid), {
    results: { cups, winners, groups, at: Date.now() },
    stage: 'reveal',
    'tasting.phase': 'closed',
  });
}

// 카운트다운 (교사가 켤 때만 TV 구석에 작게). end = 끝나는 시각(ms)
export async function setTimer(S, sec) {
  await updateDoc(sref(S.sid), { timer: sec ? { end: Date.now() + sec * 1000, sec } : null });
}
export async function addTimer(S, sec) {
  const t = S.sess.timer;
  if (!t?.end) return setTimer(S, sec);
  await updateDoc(sref(S.sid), { timer: { end: Math.max(Date.now(), t.end) + sec * 1000, sec: (t.sec || 0) + sec } });
}

export async function closeSession(S) {
  await updateDoc(sref(S.sid), { open: false, stage: 'wrap', closedAt: serverTimestamp() });
}
export async function reopenSession(sid) {
  await updateDoc(sref(sid), { open: true });
}

// 발표 화면에 쓸 모둠 상태 문구
export function groupStatus(S, g) {
  const gd = S.groups[g];
  if (!gd) return { text: '대기', sub: '' };
  const r = gd.round;
  const absent = new Set(S.sess.absent || []);
  const present = (S.sess.groups?.[g]?.members || []).filter((m) => !absent.has(m));
  const done = S.summaries[g]?.rounds?.[r]?.done || [];
  const map = {
    prep: ['준비물 챙기는 중', ''],
    free: ['각자 만들어 맛보는 중', '기록 없이 자유롭게'],
    plan: ['모둠 레시피 정하는 중', `시제품 ${r}`],
    make: ['큰 컵에 만드는 중', `시제품 ${r}`],
    rate: ['나눠 마시고 평가 중', `시제품 ${r} · ${done.length}/${present.length}명`],
    decide: ['결과 보고 의논 중', `시제품 ${r} 결과`],
    done: ['개발 완료', gd.best ? `베스트: 시제품 ${gd.best}` : ''],
  };
  const [text, sub] = map[gd.step] || ['', ''];
  return { text, sub, r, present, done };
}

