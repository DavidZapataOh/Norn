# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router). Chosen by the user so the marketing site and the future
reviewer application share one framework inside this monorepo. Static export is
acceptable for the marketing surface.

## Users

**Primary — finance operations lead.** Controller, Head of Finance, or accounts-payable
manager at a company processing meaningful invoice volume. Their job: get invoices matched
against purchase orders and paid, and be able to justify any given decision months later
when someone asks. They are audited, or they finance their receivables, or both. They are
not technical and will not read a whitepaper.

**Secondary — the technical approver.** The engineer or security lead the primary user
forwards the page to. Their job: confirm that confidential documents do not leave the
company's machines. They will check the licence and look for a repository.

**Explicitly not the audience:** hackathon judges. The page is written for the people who
would use the product.

## Product Purpose

Norn reconciles invoices against a second source of record, entirely on the user's own
hardware, and produces evidence that a third party can check without access to the user's
systems.

The problem it addresses is not reading invoices, which is largely solved. It is that a
reconciliation is a claim, and the claim is eventually read by someone who was not present
when it was produced: an auditor sampling payables, a lender underwriting a receivable, a
counterparty in a payment dispute. Those readers cannot re-derive the result and today have
no basis to accept it beyond trust in whoever hands it to them.

Success is a reconciliation an outsider accepts on the strength of the artefact rather than
on the strength of the relationship.

## Positioning

The output is an evidence bundle, not a verdict. Four properties define it, and a
competitor that discards recogniser geometry in its first pipeline stage — which is the
conventional thing to do — structurally cannot offer the first one:

1. **Provenance.** Every extracted value carries the image region and recogniser confidence
   it was read from. A reader with the source document can crop the region and compare.
2. **Abstention.** A value the system could not read is recorded as an explicit abstention
   with its region and the reason, never imputed or omitted.
3. **Selective disclosure.** External facts enter through attestations that establish one
   predicate and withhold the rest of the source response.
4. **Determinism.** The run reproduces from a recorded seed to a matching digest.

## Operating Context

Invoices arrive as photographs, scans, and PDFs — skewed, unevenly lit, in mixed
conventions. Amounts appear in Latin-American format (`2.831,40`) as often as Anglo
(`2,831.40`). The reviewer works through a queue rather than a single document, and the
output is later attached to an audit sample, a financing request, or a dispute file.

Documents routinely contain supplier pricing, bank details, and contract terms that the
organisation is unwilling or legally unable to transmit to a third party.

## Capabilities and Constraints

- All model inference runs on the user's device. There is no cloud inference path.
- Recognition returns text, bounding box, and confidence per region; geometry is carried to
  the output artefact.
- Extraction is grammar-constrained, so output is well-typed by construction.
- Multi-step reasoning uses slot-bound orchestration: the model emits references into a
  host-owned typed store, never literal values.
- Latin script only in the current implementation.
- Norn does not disburse funds and is not an ERP.
- Attested retrieval of an external fact is the single step that contacts a party outside
  the user's machine. This is disclosed rather than hidden.

## Brand Commitments

- **Name:** Norn. From the Norse fates who recorded what happened at the root of the world
  tree — a record an outsider could come and read, not an oracle pronouncing a verdict.
- **Licence:** Apache-2.0, open source.
- **Voice:** operational and plain. States limits rather than eliding them. Never claims
  "your data never leaves your device" unqualified, because the attestation step is a real
  boundary; the honest formulation is that all inference is local and every network call is
  disclosed.
- **Binding references supplied by the user:** aave.com and pok.tech — clean, graphic,
  dynamic, low text density.

## Evidence on Hand

Real, measured on an Apple M4 / 16 GB reference machine, recorded in an append-only
inference log:

- Naive multi-step tool chaining: 4/10 end-to-end correct over 10 trials. Slot-bound
  orchestration on the identical task: 10/10.
- Two distinct failure modes observed: step omission (4/10) and result substitution (2/10),
  where the model supplied a value recalled from the prompt instead of the one the tool
  returned.
- Recognition on a skewed, unevenly lit photograph: 20.3 s (detection 18.2 s, recognition
  2.0 s), 29 regions, 26 recognised correctly.
- Recogniser confidence is measurably miscalibrated: an incorrect reading returned
  confidence 0.899, higher than several correct ones.
- Extraction on a 382 MB model: 0.94 s, 117.6 tok/s, correctly parsing `2.340,00`.
- A real amount fragmented across two regions and rejoined by bounding-box adjacency.

**Absences that must not be fabricated:** no customers, no testimonials, no case studies, no
pricing, no corpus-level accuracy figure, no security certifications, no deployment claims.
There is no shipped product yet; the primary call to action is an early-access waitlist.

## Product Principles

1. **The evidence is the product.** A verdict nobody can check is the thing being replaced,
   not the thing being sold.
2. **Silence is the enemy.** A model that is wrong without signalling it is worse than one
   that refuses. Abstention is a feature and is reported, not hidden.
3. **The model reads and selects; code decides.** Every number that reaches a verdict is
   computed by deterministic code.
4. **Say the limit out loud.** Overclaiming privacy or accuracy costs more credibility than
   the claim was worth.

## Accessibility & Inclusion

Standard WCAG 2.2 AA. Two product-specific needs: the abstention state must not be
communicated by colour alone, since amber-versus-green is the primary signal in the
interface; and motion must respect `prefers-reduced-motion`, because the site's core
explanatory device is animated.
