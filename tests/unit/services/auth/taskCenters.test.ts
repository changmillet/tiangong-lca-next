// @ts-nocheck
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
function setup(authOverride?: any) {
  jest.resetModules();
  let callback: any;
  const auth =
    authOverride !== undefined
      ? authOverride
      : {
          getClaims: jest
            .fn()
            .mockResolvedValue({ data: { claims: { sub: 'owner-b' } }, error: null }),
          onAuthStateChange: jest.fn((listener) => {
            callback = listener;
            return { data: { subscription: { unsubscribe: jest.fn() } } };
          }),
        };
  const bind = [jest.fn(), jest.fn(), jest.fn()];
  jest.doMock('@/services/supabase', () => ({ supabase: { auth } }));
  jest.doMock('@/services/lca/taskCenter', () => ({ bindLcaTaskCenterOwner: bind[0] }));
  jest.doMock('@/services/tidasPackage/taskCenter', () => ({
    bindTidasPackageTaskCenterOwner: bind[1],
  }));
  jest.doMock('@/services/dataProducts/taskCenter', () => ({
    bindDataProductTaskCenterOwner: bind[2],
  }));
  const module = require('@/services/auth/taskCenters');
  const subscription = module.subscribeToTaskCenterAuthChanges();
  return {
    module,
    auth,
    bind,
    subscription,
    event: (event, id) => callback(event, id ? { user: { id } } : null),
  };
}
describe('verified task-center auth ownership', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('@/services/supabase');
    jest.dontMock('@/services/lca/taskCenter');
    jest.dontMock('@/services/tidasPackage/taskCenter');
    jest.dontMock('@/services/dataProducts/taskCenter');
  });
  it('invalidates cross-tab sign-out/sign-in immediately, then verifies the new identity outside the SDK callback', async () => {
    const { module, auth, bind, event, subscription } = setup();
    module.bindTaskCenterOwner('owner-a');
    const staleAdmission = module.getTaskCenterIdentityGeneration();
    const notified = jest.fn();
    const unsubscribe = module.subscribeTaskCenterIdentity(notified);
    event('SIGNED_OUT', null);
    event('SIGNED_IN', 'owner-b');
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith(null));
    expect(auth.getClaims).not.toHaveBeenCalled();
    expect(module.bindTaskCenterOwner('owner-a', staleAdmission)).toBe(false);
    jest.runOnlyPendingTimers();
    await flush();
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith('owner-b'));
    expect(notified).toHaveBeenCalledTimes(3);
    const generation = module.getTaskCenterIdentityGeneration();
    const calls = bind[0].mock.calls.length;
    event('TOKEN_REFRESHED', 'owner-b');
    event('SIGNED_IN', 'owner-b');
    jest.runOnlyPendingTimers();
    await flush();
    expect(module.getTaskCenterIdentityGeneration()).toBe(generation);
    expect(bind[0]).toHaveBeenCalledTimes(calls);
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    unsubscribe();
    subscription.unsubscribe();
  });
  it('keeps maintenance/anonymous bootstrap unadmitted and ignores stale verification after logout or unsubscribe', async () => {
    const { module, auth, bind, event, subscription } = setup();
    event('INITIAL_SESSION', 'owner-b');
    jest.runOnlyPendingTimers();
    await flush();
    expect(auth.getClaims).not.toHaveBeenCalled();
    module.bindTaskCenterOwner('owner-a');
    let finish: any;
    auth.getClaims.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    event('SIGNED_IN', 'owner-b');
    event('TOKEN_REFRESHED', 'owner-b');
    jest.runOnlyPendingTimers();
    await flush();
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    module.bindTaskCenterOwner(null);
    finish({ data: { claims: { sub: 'owner-b' } }, error: null });
    await flush();
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith(null));
    module.bindTaskCenterOwner('owner-a');
    auth.getClaims.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    event('SIGNED_IN', 'owner-b');
    jest.runOnlyPendingTimers();
    await flush();
    subscription.unsubscribe();
    finish({ data: { claims: { sub: 'owner-b' } }, error: null });
    await flush();
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith(null));
  });
  it.each([
    { data: { claims: { sub: 'wrong-owner' } }, error: null },
    { data: null, error: { message: 'denied' } },
    new Error('claims failed'),
  ])('fails closed for denied, mismatched or rejected claims', async (result) => {
    const { module, auth, bind, event, subscription } = setup();
    module.bindTaskCenterOwner('owner-a');
    if (result instanceof Error) auth.getClaims.mockRejectedValue(result);
    else auth.getClaims.mockResolvedValue(result);
    event('SIGNED_IN', 'owner-b');
    jest.runOnlyPendingTimers();
    await flush();
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith(null));
    subscription.unsubscribe();
  });
  it('normalizes owner identity and permits duplicate admission without restarting domain recovery', () => {
    const { module, bind, subscription } = setup();
    module.bindTaskCenterOwner(' owner-a ');
    const generation = module.getTaskCenterIdentityGeneration();
    module.bindTaskCenterOwner('owner-a');
    expect(module.getTaskCenterIdentityGeneration()).toBe(generation);
    module.bindTaskCenterOwner(' ');
    bind.forEach((mock) => expect(mock).toHaveBeenLastCalledWith(null));
    subscription.unsubscribe();
  });
  it.each([null, 17, { getClaims: jest.fn() }, () => undefined])(
    'supports isolated bootstrap without an SDK event surface',
    (auth) => {
      expect(setup(auth).subscription).toBeUndefined();
    },
  );
});
