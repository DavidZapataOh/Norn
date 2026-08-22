# Design

<!-- impeccable:design-schema 1 -->

## World

**The annotated plate.** A scientific or technical specimen sheet: a subject reproduced
faithfully, regions marked and labelled with leader lines, measurements set in a
typewriter face in the margin, nothing decorative on the page that is not a fact about the
subject.

The world is derived from the mechanism rather than from the category. Norn's actual work
is to mark regions of a document and state what it read there and how sure it is. That is
what a plate does. It also earns the motion: on a plate, annotation is something that gets
*drawn*, one callout at a time, which is exactly the hero's behaviour.

Deliberately excluded as this category's rut: the dashboard-on-gradient SaaS page, and the
"AI product" page with glowing orbs and neural filigree. Also excluded: the violet accent
both supplied references use.

Supporting families the world borrows from: the ledger (ruled columns, warm stock, ink),
the audit workpaper (tick marks, cross-reference marks, marginal annotation), and the
certified document (serial numbers, seals, redaction bars).

## Palette

Semantics come first: green, amber and red are reserved to mean *verified*, *abstained* and
*mismatch* in the product. The brand accent therefore lives outside those three, so that a
status never competes with a brand surface for the same meaning.

```
--paper        #FBFAF8   page ground, warm stock
--surface      #FFFFFF   cards, the plate itself
--surface-sunk #F4F2EE   inset panels, code blocks
--ink          #14161A   primary text
--ink-muted    #5C6470   secondary text
--ink-faint    #686F7A   annotation labels, captions
--rule         #E7E4DF   hairlines, borders
--rule-strong  #D6D2CB

--accent       #1B3A5C   deep ink blue — the signature on a ledger
--accent-hover #24507C
--accent-wash  #EEF2F6   tinted section grounds

--verified     #2F6F4E   status only
--abstained    #9A6316   status only, the product's signature state
--mismatch     #A83B2E   status only
```

Every token above clears 4.5:1 against each ground it is used on, checked rather than
eyeballed: `--ink-faint` and `--abstained` were both lightened-looking values that failed
the check and were darkened until they passed on the sunk surface, the hardest case.

Status is never carried by colour alone. Each state pairs its colour with an authored SVG
icon — drawn on one 1.5px stroke grid, never a Unicode glyph or emoji — and a text label:
a check for verified, a hollow diamond for abstained, a slash for mismatch.

## Type

A three-voice system, matching the plate: an editorial voice for the headline, a neutral
voice for reading, and a machine voice for anything measured.

| Role | Family | Use |
|---|---|---|
| Display | **Newsreader** | Headlines. Its italic carries the accent phrase, set against the sans, and is the page's most recognisable typographic move. |
| Body / UI | **Inter** | Everything read at length. Variable, tuned for small sizes. |
| Machine | **IBM Plex Mono** | Eyebrows, field names, values, confidences, coordinates, code. Anything the system measured is set in the mono. |

Rules:

- **No eyebrow labels above headings.** The heading carries its own weight. Where the
  references use a mono kicker, Norn uses the annotation itself — a real field name and
  confidence attached to a real region.
- Mono is reserved for things the system measured or named: confidences, coordinates,
  amounts, field keys, hashes, code. It is never a costume for "technical". Prose numbers
  stay in Inter.
- Tabular figures (`font-variant-numeric: tabular-nums`) on every measured value.
- Display sizes use `text-wrap: balance`; body copy uses `text-wrap: pretty`.
- One italic accent phrase per headline at most.

## Scale and rhythm

4px base. Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160.
Type steps (fluid, `clamp`): 12, 14, 16, 18, 21, 26, 34, 46, 62, 82.
Radii: 2 (hairline chips), 6 (inputs, buttons), 12 (cards), 20 (plates).
Content max-width 1200px; prose max-width 68ch.

## Components

- **Plate.** White surface, 1px `--rule` border, radius 20, a soft low shadow. Holds the
  document, the certificate, any specimen. The page's primary container.
- **Callout box.** An absolutely-positioned rectangle over a plate, 1.5px border in the
  status colour, with a leader line to a mono label carrying the field name and confidence.
  The core device.
- **Chip.** Mono, uppercase, 11px, 1px border, radius 2, paired with its status icon.
  Status and metadata.
- **Stat.** A large Newsreader figure over a mono caption, hairline rule between siblings.
  The caption sits below the figure, not above it as a kicker.
- **Button.** Radius 6, not pill — pills read consumer, and this world is documentary.
  Primary is `--accent` on white text; secondary is a hairline outline.

## Motion

Choreographed, and every animation explains something. Nothing loops for decoration.

- Hero: callout boxes draw in sequence over the invoice, ~180ms apart, each border stroking
  from 0 to full length, label fading in behind it. The amber abstention lands last and
  holds a beat longer.
- Stat figures count up on entry, once.
- Pipeline: the active step advances with scroll position; the paired visual changes with it.
- Certificate: fields populate top to bottom as the section enters.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` for entrances, 200ms for interface feedback.

`prefers-reduced-motion: reduce` resolves every sequence to its final state immediately.
The page must be fully comprehensible with motion disabled, because the annotation *is* the
explanation.

## Browser surfaces

The parts not drawn still carry the design: selection uses `--accent-wash` on `--ink`, the
caret is `--accent`, focus rings are a 2px `--accent` outline with a 2px offset, scrollbars
are themed to the rule colours, and links carry an ink-blue underline with a 3px offset.

## Voice

Operational and plain. Short sentences. Concrete nouns. States a limit rather than eliding
it — the page never claims data never leaves the device, because the attestation step is a
real boundary; it says all inference is local and every network call is disclosed.

No exclamation marks, no "revolutionary", no "seamless", no em-dash-joined marketing
triples. Numbers on the page are measured numbers and each one is traceable to the
evidence log.
