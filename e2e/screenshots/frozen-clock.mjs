// Preload for the screenshot server (node --import), in place of the suite's e2e/support/clock.mjs: the process clock
// stands still at E2E_NOW instead of running on from it. The server stamps what it serves with its clock (the status
// bar's "Updated 10:00 ET", a panel's "As of", the screener's snapshot time), so a clock that ran on would put a
// different minute into the images of each run; a frozen one gives the same images every time (docs/testing.md,
// Screenshots). Its caches never expire either, which is what a run of a few minutes wants.
//
// Only Date stands still: timers, performance.now() and process.hrtime() keep measuring real durations. Without
// E2E_NOW, or with E2E_NOW=real, the clock is left alone.

const setting = process.env.E2E_NOW;

if (setting && setting !== "real") {
  const frozen = Date.parse(setting);
  if (Number.isNaN(frozen)) throw new Error(`E2E_NOW must be an ISO date-time or "real", got ${JSON.stringify(setting)}`);

  const RealDate = Date;
  const now = () => frozen;

  // Called with new: a Date of the frozen instant (no arguments) or of the arguments; called as a function: the string
  // of that instant. Dates keep their real prototype, so instanceof, Object.prototype.toString and structured cloning
  // work. Every static is an own property (Next.js copies the own properties of the Date it finds), as in clock.mjs.
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(frozen).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [frozen] : args, new.target);
  }
  Object.defineProperties(FrozenDate, { ...Object.getOwnPropertyDescriptors(RealDate), now: { value: now, writable: true, configurable: true } });
  Object.defineProperty(RealDate.prototype, "constructor", { value: FrozenDate, writable: true, configurable: true });
  globalThis.Date = FrozenDate;
}
