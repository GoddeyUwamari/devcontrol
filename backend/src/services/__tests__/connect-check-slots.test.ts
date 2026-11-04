/**
 * ConnectCheckSlots (review H1 layers 2 and 3): one check per organization, a
 * per-process cap, atomic admission, idempotent release.
 */
import { ConnectCheckSlots, DEFAULT_CONNECT_CHECK_LIMIT } from '../connect-check-slots';

describe('ConnectCheckSlots', () => {
  it('defaults to 5 concurrent checks per process', () => {
    expect(DEFAULT_CONNECT_CHECK_LIMIT).toBe(5);
  });

  it('admits one check per organization; a second for the same organization is org_busy', () => {
    const slots = new ConnectCheckSlots();
    const first = slots.tryAcquire('org-a');
    expect(first.ok).toBe(true);
    expect(slots.tryAcquire('org-a')).toEqual({ ok: false, reason: 'org_busy' });
    expect(slots.tryAcquire('org-b').ok).toBe(true);
  });

  it('caps the process at its limit; the next organization is at_capacity until a slot is released', () => {
    const slots = new ConnectCheckSlots(3);
    const held = ['a', 'b', 'c'].map((o) => slots.tryAcquire(o));
    expect(held.every((h) => h.ok)).toBe(true);
    expect(slots.tryAcquire('d')).toEqual({ ok: false, reason: 'at_capacity' });
    (held[1] as { ok: true; slot: { release(): void } }).slot.release();
    expect(slots.tryAcquire('d').ok).toBe(true);
    expect(slots.inFlight).toBe(3);
  });

  it('an organization already running is org_busy even at capacity', () => {
    const slots = new ConnectCheckSlots(1);
    slots.tryAcquire('a');
    expect(slots.tryAcquire('a')).toEqual({ ok: false, reason: 'org_busy' });
    expect(slots.tryAcquire('b')).toEqual({ ok: false, reason: 'at_capacity' });
  });

  it('release is idempotent: a double release frees one slot, never two', () => {
    const slots = new ConnectCheckSlots(2);
    const a = slots.tryAcquire('a') as { ok: true; slot: { release(): void } };
    slots.tryAcquire('b');
    a.slot.release();
    a.slot.release();
    expect(slots.inFlight).toBe(1);
    expect(slots.tryAcquire('c').ok).toBe(true);
    expect(slots.tryAcquire('d')).toEqual({ ok: false, reason: 'at_capacity' });
  });

  it('admission is atomic: 100 synchronous attempts for 100 organizations admit exactly the limit', () => {
    const slots = new ConnectCheckSlots(5);
    const results = Array.from({ length: 100 }, (_, i) => slots.tryAcquire(`org-${i}`));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(slots.inFlight).toBe(5);
  });

  it('refuses a missing organization ID and a bad limit', () => {
    expect(() => new ConnectCheckSlots().tryAcquire('')).toThrow(/authenticated organization/);
    expect(() => new ConnectCheckSlots(0)).toThrow(/positive integer/);
  });
});
