// Preload for the end-to-end server (node --import): starts the process clock at E2E_NOW and lets it run on from
// there. The fixture data, the app's own date logic (calendar windows, cache lifetimes, "last session" labels) and the
// log lines then agree on one pinned time, and a run sees the same market whatever day it happens on. The suite
// installs the same time in the browser (e2e/support/test.ts). Without E2E_NOW, or with E2E_NOW=real, the clock is
// left alone.
//
// Only Date moves: timers, performance.now() and process.hrtime() keep measuring real durations.

const setting = process.env.E2E_NOW;

if (setting && setting !== "real") {
  const start = Date.parse(setting);
  if (Number.isNaN(start)) throw new Error(`E2E_NOW must be an ISO date-time or "real", got ${JSON.stringify(setting)}`);

  const RealDate = Date;
  const offset = start - RealDate.now();
  const now = () => RealDate.now() + offset;

  // Called with new: a Date of the shifted now (no arguments) or of the arguments; called as a function: the string
  // of now. Dates keep their real prototype, so instanceof, Object.prototype.toString and structured cloning work.
  function E2EDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [now()] : args, new.target);
  }
  // Every static as an own property (prototype, name, length, UTC, parse), with now shifted: Next.js wraps Date
  // again by copying the own properties of whatever Date it finds, so inherited statics would be lost.
  Object.defineProperties(E2EDate, { ...Object.getOwnPropertyDescriptors(RealDate), now: { value: now, writable: true, configurable: true } });
  Object.defineProperty(RealDate.prototype, "constructor", { value: E2EDate, writable: true, configurable: true });
  globalThis.Date = E2EDate;
}
