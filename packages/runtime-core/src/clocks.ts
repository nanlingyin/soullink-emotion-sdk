import type { Clock, ClockTickCallback, ManualClock } from "./types";

function nowSeconds(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

/**
 * requestAnimationFrame-backed clock. Falls back to an interval when rAF is not
 * available (e.g. Node), so importing this module never throws off the browser.
 */
export function createRafClock(): Clock {
  let handle: number | null = null;
  let running = false;
  let last = nowSeconds();

  const hasRaf =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";

  return {
    now: nowSeconds,
    start(cb: ClockTickCallback) {
      if (running) return;
      running = true;
      last = nowSeconds();

      const loop = () => {
        if (!running) return;
        const now = nowSeconds();
        const dt = now - last;
        last = now;
        cb(now, dt);
        handle = hasRaf ? requestAnimationFrame(loop) : (setTimeout(loop, 1000 / 60) as unknown as number);
      };

      handle = hasRaf ? requestAnimationFrame(loop) : (setTimeout(loop, 1000 / 60) as unknown as number);
    },
    stop() {
      running = false;
      if (handle === null) return;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
      handle = null;
    }
  };
}

/** setInterval-backed clock at a fixed frame rate. Works in any environment. */
export function createIntervalClock(fps = 60): Clock {
  const intervalMs = 1000 / Math.max(1, fps);
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = nowSeconds();

  return {
    now: nowSeconds,
    start(cb: ClockTickCallback) {
      if (timer !== null) return;
      last = nowSeconds();
      timer = setInterval(() => {
        const now = nowSeconds();
        const dt = now - last;
        last = now;
        cb(now, dt);
      }, intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Deterministic clock driven by explicit `tick(now, dt)` calls. Ideal for tests.
 * `now()` reflects the last ticked time.
 */
export function createManualClock(initial = 0): ManualClock {
  let cb: ClockTickCallback | null = null;
  let current = initial;

  return {
    now() {
      return current;
    },
    start(next: ClockTickCallback) {
      cb = next;
    },
    stop() {
      cb = null;
    },
    tick(now: number, dt: number) {
      current = now;
      cb?.(now, dt);
    }
  };
}
