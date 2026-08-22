'use client';

import { useEffect, useRef, useState } from 'react';
import { recognised, DOC_W, DOC_H, type Region } from '@/content/recognition';
import { Check, Diamond } from './icons';
import styles from './DocumentPlate.module.css';

const annotated = recognised.filter((r) => r.field);

/**
 * The annotated plate. The document is drawn from the recogniser's own output,
 * each string placed at the coordinates it was found at, so an annotation box
 * sits exactly over the text it describes. Boxes stroke in one at a time; the
 * abstained region lands last and holds.
 */
export function DocumentPlate() {
  const [drawn, setDrawn] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDrawn(annotated.length - 1);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        annotated.forEach((region, i) => {
          const delay = 500 + i * 320 + (region.state === 'abstained' ? 220 : 0);
          timers.push(setTimeout(() => setDrawn((d) => Math.max(d, i)), delay));
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <figure className={styles.plate} ref={ref}>
      <div className={styles.sheet}>
        <div className={styles.page} style={{ aspectRatio: `${DOC_W} / ${DOC_H}` }}>
          {recognised.map((r, i) => (
            <span key={i} className={`${styles.tx} ${styles[r.size]}`} style={typeset(r)}>
              {r.text}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.marks} aria-hidden>
        <div className={styles.marksInner} style={{ aspectRatio: `${DOC_W} / ${DOC_H}` }}>
          {annotated.map((r, i) => (
            <Mark key={r.field} region={r} index={i} shown={i <= drawn} />
          ))}
        </div>
      </div>

      <figcaption className={styles.caption}>
        Real output of one pass over a phone photograph. The recogniser read the tax row
        backwards, so Norn declines the field rather than reporting a number for it.
      </figcaption>
    </figure>
  );
}

function Mark({ region, index, shown }: { region: Region; index: number; shown: boolean }) {
  const side = region.side ?? (region.box[0] / DOC_W > 0.5 ? 'right' : 'left');
  const abstained = region.state === 'abstained';
  return (
    <div
      className={[
        styles.mark,
        abstained ? styles.abstained : styles.ok,
        side === 'right' ? styles.sideRight : styles.sideLeft,
        shown ? styles.isShown : '',
      ].join(' ')}
      style={{ ...frame(region), '--i': index } as React.CSSProperties}
    >
      <span className={styles.box} />
      <span className={styles.leader} />
      <span className={styles.label}>
        {abstained ? <Diamond size={12} /> : <Check size={12} />}
        <span className={styles.field}>{region.field}</span>
        <span className={styles.conf}>
          {abstained ? 'abstained' : region.conf.toFixed(3)}
        </span>
      </span>
    </div>
  );
}

/**
 * A recognised box encodes the size the glyphs were rendered at, so the type is
 * sized from the box height rather than from a fixed step. Without this the
 * facsimile drifts wider than the region it was measured in and clips the sheet.
 */
function typeset(r: Region): React.CSSProperties {
  const [, y1, , y2] = r.box;
  const fontSize = `${((y2 - y1) / DOC_W) * 100 * 0.6}cqw`;
  return { ...frame(r), fontSize };
}

function frame(r: Region): React.CSSProperties {
  const [x1, y1, x2, y2] = r.box;
  return {
    left: `${(x1 / DOC_W) * 100}%`,
    top: `${(y1 / DOC_H) * 100}%`,
    width: `${((x2 - x1) / DOC_W) * 100}%`,
    height: `${((y2 - y1) / DOC_H) * 100}%`,
  };
}
