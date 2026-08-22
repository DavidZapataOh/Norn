import { DocumentPlate } from '@/components/DocumentPlate';
import { Reveal } from '@/components/Reveal';
import { Counter } from '@/components/Counter';
import { Arrow, GitHub, propertyIcons, Diamond, Check } from '@/components/icons';
import * as copy from '@/content/copy';
import { recognised } from '@/content/recognition';
import s from './page.module.css';

export default function Page() {
  return (
    <>
      <Reveal />
      <Nav />
      <main>
        <Hero />
        <Gap />
        <Certificate />
        <Pipeline />
        <Reliability />
        <Technical />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

function Nav() {
  return (
    <header className={s.nav}>
      <div className={`container ${s.navInner}`}>
        <a href="#" className={s.wordmark} aria-label="Norn, home">
          <NornMark />
          <span>Norn</span>
        </a>
        <nav className={s.navLinks}>
          <a href="#how">How it works</a>
          <a href="#evidence">Evidence</a>
          <a href="https://github.com" className={s.navGithub}>
            <GitHub size={16} />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

/** Three threads crossing a rule: the Norns' weave, and a page with a line read across it. */
function NornMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M4 17c3-2.6 3-8.4 6-11M8 17c3-2.6 3-8.4 6-11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 11.5h17" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Hero() {
  return (
    <section className={s.hero}>
      <div className={`container ${s.heroGrid}`}>
        <div className={s.heroCopy}>
          <h1 className={s.h1}>
            {copy.hero.title[0]}{' '}
            <em className={s.accentPhrase}>{copy.hero.title[1]}</em>{' '}
            {copy.hero.title[2]}
          </h1>
          <p className={s.lede}>{copy.hero.lede}</p>
          <div className={s.actions}>
            <a href="#access" className={s.btnPrimary}>
              {copy.hero.primary}
              <Arrow size={16} />
            </a>
            <a href="https://github.com" className={s.btnSecondary}>
              <GitHub size={16} />
              {copy.hero.secondary}
            </a>
          </div>
          <p className={`mono ${s.heroNote}`}>{copy.hero.note}</p>
        </div>
        <div className={s.heroPlate}>
          <DocumentPlate />
          <FieldList />
        </div>
      </div>
    </section>
  );
}

/** The plate's marginal labels have nowhere to sit on narrow screens; this carries them. */
function FieldList() {
  const fields = recognised.filter((r) => r.field);
  return (
    <ul className={s.fieldList} aria-label="Fields read from the document">
      {fields.map((r) => {
        const abstained = r.state === 'abstained';
        return (
          <li key={r.field} className={abstained ? s.fieldAbstained : s.fieldOk}>
            {abstained ? <Diamond size={13} /> : <Check size={13} />}
            <span className={`mono ${s.fieldName}`}>{r.field}</span>
            <span className={`mono ${s.fieldConf}`}>
              {abstained ? 'abstained' : r.conf.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Gap() {
  return (
    <section className={`section ${s.gap}`}>
      <div className="container">
        <h2 className={s.h2} data-reveal>{copy.gap.title}</h2>
        <div className={s.gapBody}>
          {copy.gap.body.map((p, i) => (
            <p key={i} data-reveal style={{ '--reveal-delay': `${i * 90}ms` } as React.CSSProperties}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function Certificate() {
  return (
    <section className={`section ${s.cert}`} id="evidence">
      <div className="container">
        <div className={s.certHead}>
          <h2 className={s.h2} data-reveal>{copy.certificate.title}</h2>
          <p className={s.sectionLede} data-reveal style={{ '--reveal-delay': '80ms' } as React.CSSProperties}>
            {copy.certificate.body}
          </p>
        </div>

        <div className={s.certLayout}>
          <CertificateCard />
          <ul className={s.properties}>
            {copy.certificate.properties.map((p, i) => {
              const Icon = propertyIcons[p.icon];
              return (
                <li
                  key={p.name}
                  data-reveal
                  style={{ '--reveal-delay': `${i * 80}ms` } as React.CSSProperties}
                >
                  <Icon size={18} className={s.propIcon} />
                  <h3 className={s.h3}>{p.name}</h3>
                  <p>{p.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CertificateCard() {
  return (
    <div className={s.certCard} data-reveal>
      <div className={s.certCardHead}>
        <span className="mono">reconciliation certificate</span>
        <span className={`mono ${s.certVerdict}`}>DISCREPANCY</span>
      </div>
      <dl className={s.certRows}>
        <Row k="vendor" v="ACME CORP S.A." meta="bbox 101,60 · conf 0.958" />
        <Row k="invoice_total" v="2831.40" meta="bbox 824,591 · conf 1.000" />
        <Row k="po_approved" v="2340.00" meta="attested · redacted 3 fields" />
        <Row k="variance" v="491.40" meta="computed in code" />
        <Row k="vat_rate" v="abstained" meta="failed numeric grammar" abstained />
        <Row k="trace_root" v="0x7f3a…c209" meta="hash-chained, 4 steps" />
      </dl>
      <div className={s.certFoot}>
        <span className="mono">seed 2007</span>
        <span className="mono">replays to identical digest</span>
      </div>
    </div>
  );
}

function Row({ k, v, meta, abstained }: { k: string; v: string; meta: string; abstained?: boolean }) {
  return (
    <div className={abstained ? s.certRowAbstained : s.certRow}>
      <dt className="mono">{k}</dt>
      <dd>
        <span className={`mono ${s.certValue}`}>{v}</span>
        <span className={`mono ${s.certMeta}`}>{meta}</span>
      </dd>
    </div>
  );
}

function Pipeline() {
  return (
    <section className={`section ${s.pipeline}`} id="how">
      <div className="container">
        <h2 className={s.h2} data-reveal>{copy.pipeline.title}</h2>
        <ol className={s.steps}>
          {copy.pipeline.steps.map((step, i) => (
            <li
              key={step.name}
              data-reveal
              style={{ '--reveal-delay': `${i * 70}ms` } as React.CSSProperties}
            >
              <h3 className={s.stepName}>{step.name}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Reliability() {
  return (
    <section className={`section ${s.reliability}`}>
      <div className="container">
        <div className={s.relGrid}>
          <div>
            <h2 className={s.h2} data-reveal>{copy.reliability.title}</h2>
            <div className={s.relBody}>
              {copy.reliability.body.map((p, i) => (
                <p key={i} data-reveal style={{ '--reveal-delay': `${i * 80}ms` } as React.CSSProperties}>
                  {p}
                </p>
              ))}
            </div>
          </div>
          <div className={s.relStats} data-reveal>
            <div className={s.relStat}>
              <span className={`mono ${s.relFigure}`}><Counter value={4} total={10} /></span>
              <span className={s.relCaption}>{copy.reliability.stats[0].caption}</span>
            </div>
            <div className={`${s.relStat} ${s.relStatStrong}`}>
              <span className={`mono ${s.relFigure}`}><Counter value={10} total={10} /></span>
              <span className={s.relCaption}>{copy.reliability.stats[1].caption}</span>
            </div>
          </div>
        </div>
        <p className={s.relClosing} data-reveal>{copy.reliability.closing}</p>
      </div>
    </section>
  );
}

function Technical() {
  return (
    <section className={`section ${s.tech}`}>
      <div className="container">
        <div className={s.techHead}>
          <h2 className={s.h2} data-reveal>{copy.technical.title}</h2>
          <p className={s.sectionLede} data-reveal style={{ '--reveal-delay': '80ms' } as React.CSSProperties}>
            {copy.technical.body}
          </p>
        </div>
        <ul className={s.techList}>
          {copy.technical.points.map((p, i) => (
            <li key={p.name} data-reveal style={{ '--reveal-delay': `${i * 70}ms` } as React.CSSProperties}>
              <h3 className={s.h3}>{p.name}</h3>
              <p>{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className={`section ${s.cta}`} id="access">
      <div className="container">
        <div className={s.ctaInner} data-reveal>
          <h2 className={s.h2}>{copy.cta.title}</h2>
          <p className={s.sectionLede}>{copy.cta.body}</p>
          <form className={s.ctaForm} action="#" method="post">
            <label className={s.srOnly} htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              placeholder={copy.cta.placeholder}
              className={s.ctaInput}
              autoComplete="email"
            />
            <button type="submit" className={s.btnPrimary}>
              {copy.cta.button}
              <Arrow size={16} />
            </button>
          </form>
          <p className={s.ctaAlt}>
            <a href="#">{copy.cta.alt}</a>
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`container ${s.footerInner}`}>
        <div className={s.footerBrand}>
          <a href="#" className={s.wordmark}><NornMark /><span>Norn</span></a>
          <p>{copy.footer.tagline}</p>
        </div>
        <nav className={s.footerLinks}>
          {copy.footer.links.map((l) => (
            <a key={l.label} href={l.href}>{l.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
