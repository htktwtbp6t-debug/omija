// Firebase 연결. 모든 화면이 이 파일을 불러 쓴다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithCredential,
  GoogleAuthProvider, signOut, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export * from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAPNwIKLViScSsiVSZEK5spHlB43GWez2c',
  authDomain: 'classroom-6c098.firebaseapp.com',
  projectId: 'classroom-6c098',
  storageBucket: 'classroom-6c098.firebasestorage.app',
  messagingSenderId: '554807435565',
  appId: '1:554807435565:web:5bb033ef0d737ce0a7b3a4',
};

// 교사 이메일은 공개 코드에 그대로 두지 않고 SHA-256 값만 둔다. 실제 권한은 Firestore 보안 규칙이 정한다.
const TEACHER_HASH = 'a08dfe1967d1a18703d15283341ae33bd30524e585c7512dba691acb01a1800a';
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 로컬 테스트: localhost에서 ?emu=1 로 열면 에뮬레이터에 붙는다 (?emu=0 으로 해제).
const qs = new URLSearchParams(location.search);
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if (local && qs.has('emu')) localStorage.setItem('omija-emu', qs.get('emu'));
export const EMU = local && localStorage.getItem('omija-emu') === '1';

export const app = initializeApp(EMU ? { ...firebaseConfig, projectId: 'demo-omija' } : firebaseConfig);
export const auth = getAuth(app);
// 11/3 접속 실패 대책
// - 학교 와이파이·프록시가 실시간 스트리밍 연결을 끊는 경우가 있어 롱 폴링으로 고정한다
// - 학생 기기(카카오톡 등 인앱 브라우저 포함)는 디스크 캐시 대신 메모리 캐시: 옛 캐시 때문에 '수업 없음'이 뜨는 일을 막는다
const STUDENT_PAGE = !/(show|remote|admin)\.html$/.test(location.pathname);
export const db = initializeFirestore(app, {
  localCache: STUDENT_PAGE ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true,
});
if (EMU) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export function whenAuth() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function studentSignIn() {
  const u = await whenAuth();
  if (u && u.isAnonymous) return u;
  if (u) return null; // Google로 로그인된 브라우저(선생님 노트북)에서는 로그인을 풀지 않는다
  return (await signInAnonymously(auth)).user;
}

export async function isTeacherUser(u) {
  return !!u && !!u.email && u.emailVerified && (await sha256(u.email.toLowerCase())) === TEACHER_HASH;
}

export async function teacherSignIn() {
  if (EMU) {
    // 에뮬레이터 전용 가짜 Google 토큰 (테스트가 localStorage에 이메일을 넣어 둠)
    const cred = GoogleAuthProvider.credential(JSON.stringify({
      sub: 'teacher', email: localStorage.getItem('omija-emu-email') || 'teacher@example.com', email_verified: true,
    }));
    return (await signInWithCredential(auth, cred)).user;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}

export function logout() {
  return signOut(auth);
}

// 화면 주소에 수업 코드 등 붙이기
export function pageUrl(page, params = {}) {
  const u = new URL(page, location.href);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
