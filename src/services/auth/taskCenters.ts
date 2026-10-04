import { bindDataProductTaskCenterOwner } from '@/services/dataProducts/taskCenter';
import { bindLcaTaskCenterOwner } from '@/services/lca/taskCenter';
import { supabase } from '@/services/supabase';
import { bindTidasPackageTaskCenterOwner } from '@/services/tidasPackage/taskCenter';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

let ownerId: string | null = null;
let identityGeneration = 0;
let admitted = false;
let pendingOwnerId: string | null = null;
const listeners = new Set<() => void>();

function applyOwner(nextOwnerId: string | null): void {
  ownerId = nextOwnerId;
  pendingOwnerId = null;
  bindLcaTaskCenterOwner(nextOwnerId);
  bindTidasPackageTaskCenterOwner(nextOwnerId);
  bindDataProductTaskCenterOwner(nextOwnerId);
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getTaskCenterIdentityGeneration(): number {
  return identityGeneration;
}

export function subscribeTaskCenterIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called after verified app admission, or synchronously before explicit logout. */
export function bindTaskCenterOwner(
  nextOwnerId: string | null | undefined,
  expectedGeneration = identityGeneration,
): boolean {
  if (expectedGeneration !== identityGeneration) return false;
  const normalized = typeof nextOwnerId === 'string' ? nextOwnerId.trim() || null : null;
  const changed =
    normalized !== ownerId || admitted !== Boolean(normalized) || pendingOwnerId !== null;
  admitted = Boolean(normalized);
  if (changed) identityGeneration += 1;
  applyOwner(normalized);
  if (changed) notify();
  return true;
}

/** SDK callbacks only invalidate synchronously; claims verification runs outside its auth lock. */
export function subscribeToTaskCenterAuthChanges(): { unsubscribe(): void } | undefined {
  const auth = Reflect.get(supabase as object, 'auth');
  if (!auth || (typeof auth !== 'object' && typeof auth !== 'function')) return undefined;
  const subscribe = Reflect.get(auth, 'onAuthStateChange');
  if (typeof subscribe !== 'function') return undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = Reflect.apply(subscribe, auth, [
    (_event: AuthChangeEvent, session: Session | null) => {
      const observedOwnerId = session?.user?.id ?? null;
      if (observedOwnerId && (observedOwnerId === ownerId || observedOwnerId === pendingOwnerId))
        return;
      identityGeneration += 1;
      const generation = identityGeneration;
      clearTimeout(timer);
      applyOwner(null);
      notify();
      // Maintenance/anonymous startup must not hydrate caches before app admission.
      if (!admitted || !observedOwnerId) return;
      pendingOwnerId = observedOwnerId;
      timer = setTimeout(() => {
        void (async () => {
          try {
            const { data, error } = await supabase.auth.getClaims();
            if (stopped || generation !== identityGeneration || !admitted) return;
            if (error || data?.claims?.sub !== observedOwnerId) {
              pendingOwnerId = null;
              return;
            }
            identityGeneration += 1;
            applyOwner(observedOwnerId);
            notify();
          } catch {
            if (generation === identityGeneration) pendingOwnerId = null;
          }
        })();
      }, 0);
    },
  ]) as { data?: { subscription?: { unsubscribe(): void } } } | undefined;
  return {
    unsubscribe() {
      stopped = true;
      clearTimeout(timer);
      result?.data?.subscription?.unsubscribe();
    },
  };
}
