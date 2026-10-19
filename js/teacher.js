// 교사 기기(발표 화면·리모컨) 공통: 수업 구독, 진행, 모둠 배치, 집계, 시음회, 결과
import {
  db, doc, collection, onSnapshot, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  serverTimestamp, arrayUnion, arrayRemove, increment, deleteField,
} from './fb.js';
import { ING, Q, shuffle, avg, recipeOf } from './util.js';

export const STAGES = ['intro', 'join', 'grouping', 'brief', 'develop', 'tasting', 'reveal', 'wrap'];
export const stageIdx = (s) => STAGES.indexOf(s);

// 발표 슬라이드 순서. stage는 그 슬라이드에 오면 수업이 그 단계까지 진행됨을 뜻한다 (뒤로 가도 단계는 그대로).
export const DECK = [
  { id: 'hook', stage: 'intro', title: '도입: 맛을 숫자로?' },
  { id: 'process', stage: 'intro', title: '도입: 탐구의 큰 그림' },
  { id: 'omija', stage: 'intro', title: '도입: 우리 동네 특산품 오미자' },
  { id: 'promise', stage: 'intro', title: '도입: 오늘의 약속' },
  { id: 'join', stage: 'join', title: 'QR 접속' },
  { id: 'group', stage: 'grouping', title: '모둠 배치' },
  { id: 'rules', stage: 'brief', title: '개발 안내: 재료와 규칙' },
  { id: 'steps', stage: 'brief', title: '개발 안내: 진행 순서' },
  { id: 'board', stage: 'develop', title: '시제품 개발 (현황판)' },
  { id: 'tprep', stage: 'tasting', phase: 'prep', title: '시음회 준비 (교사 제조)' },
  { id: 'ttaste', stage: 'tasting', phase: 'open', title: '블라인드 시음' },
  { id: 'reveal', stage: 'reveal', title: '결과 공개: 컵 뒤집기' },
  { id: 'result', stage: 'reveal', title: '결과 공개: 모둠별 정리' },
  { id: 'wrap', stage: 'wrap', title: '정리: 다음 차시 예고' },
];

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
export async function goSlide(S, idx, confirmFn) {
  const sess = S.sess;
  idx = Math.max(0, Math.min(DECK.length - 1, idx));
  const target = DECK[idx];
  const upd = { slide: idx };
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
      round: 1, step: 'plan', rounds: {}, best: null, reason: '', predSweet: null, predSour: null, sommelier: null,
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
  const used = new Set();
  const nums = [];
  while (nums.length < entries.length) {
    const n = String(100 + Math.floor(Math.random() * 900));
    if (!used.has(n)) { used.add(n); nums.push(n); }
  }
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
  b.update(sref(S.sid), { stage: 'tasting', tasting: { phase: 'prep', cups: [...nums].sort() } });
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
    plan: ['배합 정하는 중', `시제품 ${r}`],
    make: ['계량 중', `시제품 ${r} · 재료 ${Object.values(gd.rounds?.[r]?.checked || {}).filter(Boolean).length}/5`],
    label: ['라벨 붙이는 중', `시제품 ${r}`],
    rate: ['맛 평가 중', `시제품 ${r} · ${done.length}/${present.length}명`],
    decide: ['다음 배합 의논 중', `시제품 ${r} 결과 보는 중`],
    done: ['개발 완료', gd.best ? `베스트: 시제품 ${gd.best}` : ''],
  };
  const [text, sub] = map[gd.step] || ['', ''];
  return { text, sub, r, present, done };
}

