/**
 * Lumetra Motion Study v1 — additive and reversible enhancement.
 * No framework or network dependency. No catalogue, URLs, or rights logic changed.
 * Uses IntersectionObserver and composited CSS transforms; respects motion/data preferences.
 */
export function startLumetraMotion() {
  const main = document.querySelector('#main');
  if (!main) return () => {};
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarseQuery = window.matchMedia('(pointer: coarse)');
  const saveData = Boolean(navigator.connection?.saveData);
  const isReduced = () => reducedQuery.matches || document.documentElement.classList.contains('reduced') || saveData;
  const enabledPointer = () => !isReduced() && !coarseQuery.matches && window.matchMedia('(hover: hover)').matches;
  let pending = 0;
  const controllers = new Map();
  let revealObserver;
  const revealTargets = '.film-card[data-reveal], .essay-card[data-reveal], .era[data-reveal], .museum-object[data-reveal], .archive-door, .archive-threshold .threshold-copy, .archive-threshold .threshold-art, .journey-chapter .chapter-copy';
  const motionTargets = '.film-card .poster, .archive-threshold, .archive-door';

  function release() {
    revealObserver?.disconnect();
    revealObserver = undefined;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    main.querySelectorAll('.will-reveal').forEach((el) => el.classList.remove('will-reveal'));
  }

  function refresh() {
    pending = 0;
    release();
    const still = isReduced();
    document.documentElement.classList.toggle('lumetra-motion-off', still);
    if (still) return;
    if ('IntersectionObserver' in window) {
      revealObserver = new IntersectionObserver((entries, observer) => {
        for (const { target, isIntersecting } of entries) {
          if (!isIntersecting) continue;
          target.classList.remove('will-reveal');
          target.classList.add('did-reveal');
          observer.unobserve(target);
        }
      }, { threshold: 0.06, rootMargin: '0px 0px 70px 0px' });
      for (const [index, el] of main.querySelectorAll(revealTargets).entries()) {
        if (el.classList.contains('did-reveal')) continue;
        // Only enhance off-screen elements: don't hide essential above-the-fold content.
        if (el.getBoundingClientRect().top < window.innerHeight * .85) continue;
        el.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 65}ms`);
        el.classList.add('will-reveal');
        revealObserver.observe(el);
      }
    }
    if (!enabledPointer()) return;
    for (const el of main.querySelectorAll(motionTargets)) {
      const controller = new AbortController();
      controllers.set(el, controller);
      let raf = 0;
      const isPoster = el.matches('.film-card .poster');
      const apply = (event) => {
        if (raf) cancelAnimationFrame(raf);
        const bounds = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
        const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
        raf = requestAnimationFrame(() => {
          if (isPoster) {
            el.style.setProperty('--motion-rotate-x', `${((.5 - y) * 6).toFixed(2)}deg`);
            el.style.setProperty('--motion-rotate-y', `${((x - .5) * 6).toFixed(2)}deg`);
          }
          el.style.setProperty('--motion-light-x', `${Math.round(x * 100)}%`);
          el.style.setProperty('--motion-light-y', `${Math.round(y * 100)}%`);
          raf = 0;
        });
      };
      const reset = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        el.style.removeProperty('--motion-rotate-x');
        el.style.removeProperty('--motion-rotate-y');
        el.style.removeProperty('--motion-light-x');
        el.style.removeProperty('--motion-light-y');
      };
      el.addEventListener('pointermove', apply, { passive: true, signal: controller.signal });
      el.addEventListener('pointerleave', reset, { signal: controller.signal });
      controller.signal.addEventListener('abort', reset, { once: true });
    }
  }

  const schedule = () => { if (!pending) pending = requestAnimationFrame(refresh); };
  const mainChanges = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList')) schedule();
  });
  // Route rendering replaces main's direct children; avoid reinitializing on text updates.
  mainChanges.observe(main, { childList: true });
  const rootChanges = new MutationObserver(schedule);
  rootChanges.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  reducedQuery.addEventListener?.('change', schedule);
  schedule();
  return () => {
    mainChanges.disconnect();
    rootChanges.disconnect();
    reducedQuery.removeEventListener?.('change', schedule);
    if (pending) cancelAnimationFrame(pending);
    release();
  };
}
