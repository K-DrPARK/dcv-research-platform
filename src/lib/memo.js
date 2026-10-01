// Worker isolate 단위의 짧은 TTL 메모. 같은 isolate 에서 연속 실행되는 compute_candidate 작업들이
// 정의/보정계수/에폭 패널을 매번 D1 에서 다시 읽는 것을 막는다(작업 1건당 수백 행 → 0행).
// - DB 바인딩(WeakMap) 별로 격리되므로 테스트/다중 DB 에서 서로 섞이지 않는다.
// - 쓰기 경로(정의 저장, 에폭 import, 재보정, 시나리오 변경)는 bust() 로 즉시 무효화한다.
//   다른 isolate 의 캐시는 최대 TTL 동안만 남는다(프로토콜 무결성 검사가 드리프트를 별도로 잡는다).
const stores = new WeakMap();
const DEFAULT_TTL_MS = 60_000;

function storeFor(env) {
  const key = env?.DB; if (!key || typeof key !== 'object') return null;
  let s = stores.get(key); if (!s) { s = new Map(); stores.set(key, s); }
  return s;
}

export async function cached(env, projectId, name, loader, ttlMs = DEFAULT_TTL_MS) {
  const s = storeFor(env); if (!s) return loader();
  const k = `${projectId}\u0000${name}`, hit = s.get(k), now = Date.now();
  if (hit && hit.exp > now) return hit.value;
  const value = await loader();
  s.set(k, { value, exp: now + ttlMs });
  return value;
}

export function bust(env, projectId, name = null) {
  const s = storeFor(env); if (!s) return;
  for (const k of [...s.keys()]) if (k.startsWith(`${projectId}\u0000`) && (!name || k === `${projectId}\u0000${name}`)) s.delete(k);
}
