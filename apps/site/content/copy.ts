/**
 * Every string on the page. Numbers here are measured values from the reference
 * machine (Apple M4, 16 GB) and are traceable to the evidence log; see PRODUCT.md.
 */

export const hero = {
  title: ['Reconcile invoices', 'without sending', 'them anywhere.'],
  lede:
    'Norn reads your invoices on your own machine and produces evidence an auditor can verify without taking your word for it.',
  primary: 'Get early access',
  secondary: 'View on GitHub',
  note: 'Apache-2.0. Every model runs on your device.',
};

export const gap = {
  title: 'Someone will question this number later.',
  body: [
    'Your team matches an invoice to a purchase order and approves it. Months later an auditor pulls that invoice, or a lender asks whether the receivable is real, or a supplier insists they were already paid.',
    'Each of them has to accept a figure they cannot re-derive. Today the only thing behind it is your word.',
  ],
};

export const certificate = {
  title: 'Every number points back at the pixels it came from.',
  body:
    'Norn produces a certificate rather than a verdict. Each value in it carries the region of the document it was read from and the confidence the recogniser assigned.',
  properties: [
    {
      name: 'Provenance',
      body: 'Crop the region and compare it against the value yourself.',
      icon: 'crosshair' as const,
    },
    {
      name: 'Abstention',
      body: 'A field Norn could not read is marked with the reason it failed, and Norn never fills it in with a guess.',
      icon: 'diamond' as const,
    },
    {
      name: 'Attested facts',
      body: 'External records arrive as proof of one specific fact, and the rest of the response stays redacted.',
      icon: 'seal' as const,
    },
    {
      name: 'Replay',
      body: 'Run it again and you get the same certificate, byte for byte.',
      icon: 'repeat' as const,
    },
  ],
};

export const pipeline = {
  title: 'What happens to a document.',
  steps: [
    {
      name: 'It reads the page',
      body: 'Recognition returns every region with its coordinates and its confidence. Norn keeps all of it, because flattening the page to plain text is where auditability gets lost.',
    },
    {
      name: 'It repairs what broke',
      body: 'Recognisers split amounts across two regions. Norn rejoins them by their position on the page and keeps the lower of the two confidences.',
    },
    {
      name: 'It refuses to guess',
      body: 'Confidence on its own is not a safety signal. A value has to match the expected format and agree with the arithmetic printed on the document before Norn admits it.',
    },
    {
      name: 'It checks the outside fact',
      body: 'The purchase order amount arrives with proof that it came from your system unmodified, with everything else in the response redacted.',
    },
    {
      name: 'It hands you the evidence',
      body: 'A signed certificate carrying the reasoning, the abstentions, and the seed that reproduces the run.',
    },
  ],
};

export const reliability = {
  title: 'We measured where the model breaks.',
  body: [
    'Small models fail at multi-step work in two ways. They skip a step, which is easy to spot. Or they call the right tool and then answer with a number they remembered instead of the one it returned, which is not.',
    'The second kind produces a clean-looking result with a wrong number inside it. We ran the same reconciliation ten times to see how often that happened.',
  ],
  stats: [
    { figure: '4/10', caption: 'correct with a conventional agent loop' },
    { figure: '10/10', caption: 'correct with the architecture Norn ships' },
  ],
  closing:
    'A better prompt does not fix this. Norn never lets the model hold a number at all. It names which fact to use, and the arithmetic runs in code.',
};

export const technical = {
  title: 'For the person who has to approve this.',
  body: 'Someone will ask whether the documents leave the building. They do not.',
  points: [
    {
      name: 'Inference is local',
      body: 'Every model runs on the device. The codebase has no cloud inference path, disabled or otherwise.',
    },
    {
      name: 'Network calls are disclosed',
      body: 'Every call the software makes is listed in a manifest you can read. One step contacts an outside party, and we name it.',
    },
    {
      name: 'Open source',
      body: 'Apache-2.0. Read the pipeline, run the benchmarks, and check the numbers on this page.',
    },
    {
      name: 'It runs on a laptop',
      body: 'Measured on a 16 GB MacBook, with no GPU cluster and no inference bill.',
    },
  ],
};

export const cta = {
  title: 'Get early access.',
  body: 'Norn is still in development. Leave your email and we will reach out when there is something to try.',
  placeholder: 'you@company.com',
  button: 'Request access',
  alt: 'Or read the whitepaper.',
};

export const footer = {
  tagline:
    'Norn reconciles documents on your own hardware and produces evidence a third party can verify.',
  links: [
    { label: 'GitHub', href: 'https://github.com' },
    { label: 'Whitepaper', href: '#' },
    { label: 'Licence', href: '#' },
  ],
};
