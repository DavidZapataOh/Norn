'use client';

import { useEffect } from 'react';

/** Releases [data-reveal] elements as they enter. One observer for the page. */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]');
    document.documentElement.classList.add('js-reveal');

    // Anything already on screen at load is released immediately rather than
    // waiting for a scroll that may never come.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('js-reveal');
    };
  }, []);

  return null;
}
