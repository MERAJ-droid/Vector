// Prevent axios (ESM) from being loaded — only pure helpers are tested here
jest.mock('../../services/versionsAPI', () => ({}));

import {
  getMarkerType,
  buildSession,
  stripTimestamp,
  formatRelative,
  calcPosition,
  groupVersionsIntoSessions,
} from './TimelineScrubber';
import type { Version } from '../../services/versionsAPI';

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeVersion(overrides: Partial<Version> & { createdAt?: string } = {}): Version {
  return {
    id: 1,
    versionNumber: 1,
    commitMessage: null,
    description: null,
    fileSize: 100,
    createdAt: new Date('2026-05-10T10:00:00.000Z').toISOString(),
    createdBy: { id: 1, username: 'alice' },
    ...overrides,
  };
}

// Produce an ISO string that is `ms` milliseconds after a base time
const BASE = new Date('2026-05-10T10:00:00.000Z').getTime();
function at(ms: number): string {
  return new Date(BASE + ms).toISOString();
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// ─── getMarkerType ────────────────────────────────────────────────────────────

describe('getMarkerType', () => {
  it('returns "manual" for a null commit message', () => {
    expect(getMarkerType(makeVersion({ commitMessage: null }))).toBe('manual');
  });

  it('returns "manual" for a user-written message', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Fixed the login bug' }))).toBe('manual');
  });

  it('returns "session-end" for "Session end — May 10, 10:00"', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Session end — May 10, 10:00' }))).toBe('session-end');
  });

  it('returns "session-end" for "Session checkpoint — May 10, 10:00"', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Session checkpoint — May 10, 10:00' }))).toBe('session-end');
  });

  it('returns "session-end" for "Auto-checkpoint (30 min) — May 10, 10:30"', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Auto-checkpoint (30 min) — May 10, 10:30' }))).toBe('session-end');
  });

  it('returns "restore" for a Restored message', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Restored to v3 — May 10, 10:00' }))).toBe('restore');
  });

  it('returns "auto" for "Auto-save checkpoint"', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Auto-save checkpoint' }))).toBe('auto');
  });

  it('returns "auto" for "Initial version"', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'Initial version' }))).toBe('auto');
  });

  it('is case-insensitive', () => {
    expect(getMarkerType(makeVersion({ commitMessage: 'SESSION END — May 10, 10:00' }))).toBe('session-end');
    expect(getMarkerType(makeVersion({ commitMessage: 'RESTORED TO v2' }))).toBe('restore');
  });
});

// ─── buildSession ─────────────────────────────────────────────────────────────

describe('buildSession', () => {
  it('sets startVersion to the first element and endVersion to the last', () => {
    const v1 = makeVersion({ id: 1, versionNumber: 1, createdAt: at(0) });
    const v2 = makeVersion({ id: 2, versionNumber: 2, createdAt: at(5 * MIN) });
    const v3 = makeVersion({ id: 3, versionNumber: 3, createdAt: at(10 * MIN) });
    const session = buildSession([v1, v2, v3]);
    expect(session.startVersion.id).toBe(1);
    expect(session.endVersion.id).toBe(3);
    expect(session.versions).toHaveLength(3);
  });

  it('type is "active" when all messages are auto-generated', () => {
    const vers = [
      makeVersion({ commitMessage: 'Session end — May 10, 10:00' }),
      makeVersion({ commitMessage: 'Auto-checkpoint (30 min) — May 10, 10:30' }),
    ];
    expect(buildSession(vers).type).toBe('active');
  });

  it('type is "restore" when any message includes "Restored"', () => {
    const vers = [
      makeVersion({ commitMessage: 'Session end — May 10, 10:00' }),
      makeVersion({ commitMessage: 'Restored to v3 — May 10, 10:05' }),
    ];
    expect(buildSession(vers).type).toBe('restore');
  });

  it('type is "manual" when any message is user-written', () => {
    const vers = [
      makeVersion({ commitMessage: 'Session end — May 10, 10:00' }),
      makeVersion({ commitMessage: 'Refactored auth module' }),
    ];
    expect(buildSession(vers).type).toBe('manual');
  });

  it('type is "manual" for a single version with a user message', () => {
    expect(buildSession([makeVersion({ commitMessage: 'Initial setup' })]).type).toBe('active');
    expect(buildSession([makeVersion({ commitMessage: 'My feature' })]).type).toBe('manual');
  });

  it('works for a single-version session', () => {
    const v = makeVersion({ id: 99, commitMessage: 'Session end — May 10, 10:00' });
    const session = buildSession([v]);
    expect(session.startVersion.id).toBe(99);
    expect(session.endVersion.id).toBe(99);
    expect(session.type).toBe('active');
  });
});

// ─── groupVersionsIntoSessions ────────────────────────────────────────────────

describe('groupVersionsIntoSessions', () => {
  it('returns empty array for empty input', () => {
    expect(groupVersionsIntoSessions([])).toEqual([]);
  });

  it('puts all versions in one group when all gaps are under the threshold', () => {
    const versions = [
      makeVersion({ id: 1, createdAt: at(0) }),
      makeVersion({ id: 2, createdAt: at(5 * MIN) }),
      makeVersion({ id: 3, createdAt: at(10 * MIN) }),
    ];
    const groups = groupVersionsIntoSessions(versions);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('splits into two groups when gap exceeds threshold', () => {
    const versions = [
      makeVersion({ id: 1, createdAt: at(0) }),
      makeVersion({ id: 2, createdAt: at(5 * MIN) }),
      // 2-hour gap — well above the 30-minute default threshold
      makeVersion({ id: 3, createdAt: at(5 * MIN + 2 * HOUR) }),
      makeVersion({ id: 4, createdAt: at(5 * MIN + 2 * HOUR + 5 * MIN) }),
    ];
    const groups = groupVersionsIntoSessions(versions);
    expect(groups).toHaveLength(2);
    expect(groups[0].map(v => v.id)).toEqual([1, 2]);
    expect(groups[1].map(v => v.id)).toEqual([3, 4]);
  });

  it('respects a custom gapMs argument', () => {
    const versions = [
      makeVersion({ id: 1, createdAt: at(0) }),
      // 10-minute gap — over a 5-minute custom threshold, under default 30-minute
      makeVersion({ id: 2, createdAt: at(10 * MIN) }),
    ];
    const defaultGroups = groupVersionsIntoSessions(versions);
    const tightGroups = groupVersionsIntoSessions(versions, 5 * MIN);
    expect(defaultGroups).toHaveLength(1); // within 30 min → one group
    expect(tightGroups).toHaveLength(2);   // over 5 min → split
  });

  it('creates one group per version when every gap exceeds the threshold', () => {
    const versions = [
      makeVersion({ id: 1, createdAt: at(0) }),
      makeVersion({ id: 2, createdAt: at(HOUR) }),
      makeVersion({ id: 3, createdAt: at(2 * HOUR) }),
    ];
    const groups = groupVersionsIntoSessions(versions, 5 * MIN);
    expect(groups).toHaveLength(3);
    groups.forEach(g => expect(g).toHaveLength(1));
  });
});

// ─── stripTimestamp ───────────────────────────────────────────────────────────

describe('stripTimestamp', () => {
  it('strips "— May 10, 01:15" suffix', () => {
    expect(stripTimestamp('Session end — May 10, 01:15')).toBe('Session end');
  });

  it('strips "— Jun 3, 02:30 AM" suffix', () => {
    expect(stripTimestamp('Session checkpoint — Jun 3, 02:30 AM')).toBe('Session checkpoint');
  });

  it('strips suffix from marathon messages', () => {
    expect(stripTimestamp('Auto-checkpoint (30 min) — May 10, 10:30')).toBe('Auto-checkpoint (30 min)');
  });

  it('leaves a plain user message unchanged', () => {
    expect(stripTimestamp('Fixed the login bug')).toBe('Fixed the login bug');
  });

  it('leaves a message with a hyphen but no timestamp unchanged', () => {
    expect(stripTimestamp('Add user-agent header')).toBe('Add user-agent header');
  });

  it('handles em dash, en dash, and hyphen variants', () => {
    expect(stripTimestamp('Session end — May 10, 10:00')).toBe('Session end'); // em dash
    expect(stripTimestamp('Session end – May 10, 10:00')).toBe('Session end'); // en dash
    expect(stripTimestamp('Session end - May 10, 10:00')).toBe('Session end'); // hyphen
  });
});

// ─── calcPosition ─────────────────────────────────────────────────────────────

describe('calcPosition', () => {
  it('returns 0 for a version at timeMin', () => {
    expect(calcPosition(at(0), BASE, 100_000)).toBe(0);
  });

  it('returns 1 for a version at timeMax (timeMin + timeSpan)', () => {
    expect(calcPosition(at(100_000), BASE, 100_000)).toBe(1);
  });

  it('returns 0.5 for a version exactly in the middle', () => {
    expect(calcPosition(at(50_000), BASE, 100_000)).toBe(0.5);
  });

  it('returns 0 when timeSpan is 0 (only one point in time)', () => {
    expect(calcPosition(at(0), BASE, 0)).toBe(0);
  });

  it('clamps to 0 for a version before timeMin', () => {
    // Version is 10s before timeMin
    const beforeMin = new Date(BASE - 10_000).toISOString();
    expect(calcPosition(beforeMin, BASE, 100_000)).toBe(0);
  });

  it('clamps to 1 for a version after timeMax', () => {
    // Version is 10s after timeMax
    expect(calcPosition(at(110_000), BASE, 100_000)).toBe(1);
  });
});

// ─── formatRelative ───────────────────────────────────────────────────────────

describe('formatRelative', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "just now" for less than 1 minute ago', () => {
    const thirtySecsAgo = new Date('2026-05-10T11:59:30.000Z').toISOString();
    expect(formatRelative(thirtySecsAgo)).toBe('just now');
  });

  it('returns minutes for less than 1 hour ago', () => {
    const fortyFiveMinAgo = new Date('2026-05-10T11:15:00.000Z').toISOString();
    expect(formatRelative(fortyFiveMinAgo)).toBe('45m');
  });

  it('returns hours for less than 24 hours ago', () => {
    const twoHoursAgo = new Date('2026-05-10T10:00:00.000Z').toISOString();
    expect(formatRelative(twoHoursAgo)).toBe('2h');
  });

  it('returns days for 24 hours or more ago', () => {
    const threeDaysAgo = new Date('2026-05-07T12:00:00.000Z').toISOString();
    expect(formatRelative(threeDaysAgo)).toBe('3d');
  });
});