# Verifying a certificate

A certificate is a record of how one document was read and what was concluded from it. This
page is the procedure for checking that record yourself.

Eight steps. **Six of them need only the certificate**; one needs the source document as well,
and one needs this software installed. That split matters: someone who holds the certificate
and does not hold the invoice can still complete six of the eight.

```
node scripts/verify-certificate.js path/to/certificate.json
node scripts/verify-certificate.js path/to/certificate.json --document path/to/invoice.pdf
```

The verifier exits `0` when nothing failed and `1` when something did. It depends on nothing
but Node's standard library and one file from this repository, so it runs on a machine that has
neither the models nor the application installed.

---

## 1. Signature — certificate only

The signature is Ed25519 over a canonical serialisation of the whole certificate except the
signature itself. Canonical means: object keys sorted, strings normalised, no whitespace. The
rules are in `lib/canonical.js` and are exported as prose so another implementation can
reproduce the same bytes.

**What passing means.** Nobody has altered a byte of this certificate since it was signed.

**What passing does not mean.** It does not mean the signer is who they claim. The public key
travels inside the certificate, there is no key distribution and no revocation, and a key you
have not seen before tells you nothing about who holds it. Anyone can produce a certificate
with any content and sign it with a key they made a second ago; it will verify.

Every other step exists because of that limit.

## 2. Provenance — certificate and document

This is the step that requires no trust in the operator. Every other step checks that the
certificate is consistent with itself, which someone determined could arrange while the numbers
were wrong. This one checks it against the page.

Run the verifier with `--document` and it prints, per field, a region and the value the
certificate claims is in it:

```
  total    page 1 [334.34, 672.00, 443.28, 692.00]  expect 52381 EUR
```

**Doing this by hand.** The verifier does not crop the page — rasterising would pull a browser
engine into a program whose whole point is having no dependencies — so the comparison is yours
to make. You need to know what the numbers mean:

- **`[x0, y0, x1, y1]`**, in the same units as `document.width` and `document.height`, which
  the certificate carries. The example above sits on a `1190.55 × 1683.78` page.
- **The origin is the top-left corner, and y increases downward.** In the example, the vendor
  name is at `y ≈ 178` and the total at `y ≈ 672`: the larger y is further down the page.
- **One unit is half a PDF point**, because pages are read at twice their natural size.
  `1190.55 × 1683.78` is A4 (`595.28 × 841.89` points) doubled. To place a region in a viewer
  showing the page at some other size, scale by `viewer_width / document.width`.
- **The extent is fractional and a rendered image is not.** `1190.55 × 1683.78` rasterises to
  `1191 × 1684` pixels. Round, do not recompute: the difference is under a pixel and is not a
  disagreement.
- **Regions overlap.** A currency code and the amount beside it are separate fields whose boxes
  can cover the same row, so cropping one exactly may show the other. That is the page, not an
  error in the record.

So for the example: open the PDF, and the total is the text occupying the horizontal band from
28% to 37% of the page's width, 40% of the way down. Look at it. It should read `523,81`, which
is `52381` minor units in `EUR`.

**Amounts are integers in minor units, carried as strings.** `52381` is `523.81`. A JSON number
cannot hold a monetary amount without a precision claim nobody is entitled to make, so the
certificate does not use one.

**Read the abstentions too.** A field that was refused appears in `abstentions`, not in
`fields`, with the check that refused it and the value that was declined. Those are the places
the software says it could not read the page well enough to make a claim — checking them by eye
is how you find out whether it was right to stop.

## 3. Attestations — certificate only

External facts with evidence of their origin. **Not implemented.** The certificate carries an
empty `attestations` list and the verifier reports the step as `not applicable`.

It is reported rather than omitted on purpose: a procedure whose output has one fewer line when
a feature is missing gives you no way to tell a missing step from a step that passed silently.

## 4. Arithmetic — certificate only

The identities the document states about itself, recomputed from the amounts in the
certificate:

- `subtotal + tax = total`
- `tax = subtotal × rate`

Tolerance is two minor units, which exists for the rounding of a percentage and nothing else.

This is **recomputed, not read**. The certificate records which checks ran during the original
run, and anyone editing an amount would edit those too. Recomputing is the only version of this
check worth anything, and it is the only step besides the signature that catches an altered
amount without the document in hand.

If an operand was refused by the gate, the step reports `not checked` and names what is
missing. An identity built on a value the software declined to read is an identity built on
nothing, and reporting it as passed would be inventing evidence.

## 5. Trace — certificate only

Each stage of the run appended a record chained to the one before it: routing, reading the
page, extraction, binding values to regions, arithmetic, and the gate. Each record carries the
chain value it produced, so recomputing the chain finds not just that a record was altered but
**which one**.

Records carry stage names and digests, never values. That is what lets a certificate go to
someone entitled to check the process but not the figures.

**What passing means.** The recorded sequence of stages is the sequence that was signed, in
that order, with nothing inserted, removed or reordered.

## 6. Sections — certificate only

Two structural rules, both checkable without the page.

**Fields and abstentions are disjoint.** A key cannot be both read and refused.

**Together they account for exactly the declared list.** The certificate carries `declared`,
the field keys the template asked for. Every one of them must appear in `fields` or in
`abstentions`, and nothing may appear in either that was not declared.

That second rule is what catches a deleted abstention. Without it, deleting one leaves a
certificate that is internally consistent and quietly incomplete — which is exactly how a
document would be made to look cleaner than the run was.

The step also checks that each admitted field's region lies inside the page, and that amounts
are carried as decimal strings rather than JSON numbers.

## 7. Descriptor — certificate only

That the `replay` section names a model, a quantisation, a runtime version, a seed and an input
digest. If reproducing the run needs anything not recorded there, the descriptor is incomplete
and that is a defect in the certificate rather than something replay discovers later.

## 8. Replay — needs this software

Optional, and the only step that needs the models installed.

```
node scripts/replay.js path/to/certificate.json --documents path/to/directory
```

The certificate's `replay` section carries the model, its quantisation, the runtime version and
the seed. Replay re-runs the pipeline from those and compares the result to the certificate,
byte for byte, reporting the first differing path if they disagree.

The input is found **by digest**, not by the path recorded in the certificate, so this works on
a machine that is not the one that produced it.

A different runtime version or a different model reports **not comparable**, which is a third
outcome and not a failure. Byte-identical output across runtime versions is not something this
software can promise: a runtime is entitled to change its sampling or its tokeniser between
releases, and none of that would be a defect.

**What replay establishes.** That the reported execution is the one that occurred.

**What it does not establish.** That the execution was right. Provenance and abstention address
correctness; replay addresses whether the document in your hand describes what actually ran. A
wrong answer reproduces exactly as faithfully as a right one.

---

## What each step can and cannot catch

| Alteration | Caught by |
|---|---|
| An amount changed | `arithmetic`, and `signature` |
| An abstention deleted | `sections`, and `signature` |
| A trace record reordered or edited | `trace`, and `signature` |
| A confidence changed | `signature` only |
| A region moved | `signature` only, unless you check step 2 by eye |
| The seed changed | `signature` only |

The three in the bottom half are internally consistent after editing: nothing else in the
certificate contradicts them. That is worth knowing plainly, because it is the same as saying
that **an unsigned certificate cannot be checked for those at all**, and a certificate whose
signature does not verify should be read as making no claims rather than as making most of
them.
