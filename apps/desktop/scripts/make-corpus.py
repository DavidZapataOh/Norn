"""Generates the reading corpus and its localisation ground truth.

Every document is synthetic and obviously so: invented vendors, invented amounts, and tax
identifiers marked fake. Ground-truth boxes are computed from the draw calls that produce
the page, so they are independent of the recogniser being measured. Deriving them from a
recognition pass would score the recogniser against itself.

Boxes are written in the coordinate space the pipeline actually produces: pixels of the
rasterised page at RENDER_SCALE, origin top-left.

Run: python3 scripts/make-corpus.py
"""

import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "..", "fixtures", "corpus")

# Must match lib/raster.js. A box recorded at another scale would score every localisation
# as a mislocation.
RENDER_SCALE = 2
PHOTO_SIZE = (1000, 1500)
# A page image saved as a PDF at this resolution becomes pixels*72/DPI points, and the
# rasteriser then multiplies by RENDER_SCALE. A box recorded in the source image's pixels
# is therefore off by this factor once the page has been through that round trip.
SCAN_DPI = 150.0
SCAN_FACTOR = 72.0 * RENDER_SCALE / SCAN_DPI


def money(value_minor, convention):
    """2831.40 as "2.831,40" or "2,831.40". The corpus needs both conventions for the
    same underlying value, since reading one as the other is a 1000x error."""
    units, cents = divmod(abs(value_minor), 100)
    groups = f"{units:,}"
    if convention == "latin":
        return f"{groups.replace(',', '.')},{cents:02d}"
    return f"{groups},{cents:02d}"


def invoice_lines(spec):
    """The document as (key, label, value) rows. key is None for rows with no tracked field."""
    c = spec["convention"]
    rows = [
        (None, "INVOICE", ""),
        ("vendor", spec["vendor"], ""),
        (None, "Calle Mayor 14, 28013 Madrid", ""),
        (None, "VAT ID: ES-X0000000X (fake)", ""),
        ("invoice_no", f"Invoice no. {spec['invoice_no']}", ""),
        ("date", f"Issue date: {spec['date']}", ""),
        (None, "Bill to: Acme Robotics GmbH (fake)", ""),
        (None, "", ""),
        (None, "Description            Qty      Unit       Amount", ""),
        (None, f"Copier paper A4         40    {money(820, c)}   {money(spec['subtotal'] - 10500, c)}", ""),
        (None, f"Card stock A3           12    {money(675, c)}    {money(10500, c)}", ""),
        (None, "", ""),
        (None, f"Subtotal                             {money(spec['subtotal'], c)}", ""),
    ]
    if spec.get("vat_minor") is not None:
        rows.append(("vat", f"VAT 21%                               {money(spec['vat_minor'], c)}", ""))
    rows.append(("total", f"Total due                            {money(spec['total_minor'], c)}", ""))
    rows.append((None, "Payment to IBAN ES00 0000 0000 0000 (fake)", ""))
    return rows


def field_value(key, spec):
    c = spec["convention"]
    return {
        "vendor": spec["vendor"],
        "invoice_no": spec["invoice_no"],
        "date": spec["date"],
        "vat": money(spec["vat_minor"], c) if spec.get("vat_minor") is not None else None,
        "total": money(spec["total_minor"], c),
    }[key]


def draw_pdf(path, spec):
    """A digital PDF with a real text layer. Returns ground-truth boxes in render pixels."""
    page_w, page_h = A4
    c = canvas.Canvas(path, pagesize=(page_w, page_h))
    fields, y = [], page_h - 70

    for key, line, _ in invoice_lines(spec):
        size = 20 if line == "INVOICE" else 10
        font = "Helvetica-Bold" if key in ("vendor", "total") or line == "INVOICE" else "Helvetica"
        c.setFont(font, size)
        c.drawString(56, y, line)

        if key:
            value = field_value(key, spec)
            # The box covers the value itself, not its label, so a hit means the reader
            # located the number rather than the row it sits on.
            prefix = line[: line.rindex(value)] if value and value in line else ""
            x0 = 56 + pdfmetrics.stringWidth(prefix, font, size)
            x1 = x0 + pdfmetrics.stringWidth(value, font, size)
            ascent = size * 0.75
            descent = size * 0.21
            fields.append({
                "field": key,
                "text": value,
                "bbox": [round(x0 * RENDER_SCALE, 1), round((page_h - y - ascent) * RENDER_SCALE, 1),
                         round(x1 * RENDER_SCALE, 1), round((page_h - y + descent) * RENDER_SCALE, 1)],
            })
        y -= size + 9

    c.showPage()
    c.save()
    return fields


def _font(size, bold=False):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
              else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def rotate_box(box, angle, size):
    """Where a box lands after PIL rotates the image counter-clockwise about its centre."""
    cx, cy = size[0] / 2, size[1] / 2
    t = math.radians(angle)
    xs, ys = [], []
    for x, y in ((box[0], box[1]), (box[2], box[1]), (box[0], box[3]), (box[2], box[3])):
        dx, dy = x - cx, y - cy
        xs.append(cx + dx * math.cos(t) + dy * math.sin(t))
        ys.append(cy - dx * math.sin(t) + dy * math.cos(t))
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def draw_image(spec, skew=0.0, uneven=False, seed=5):
    """A page as pixels, the way a scanner or a phone delivers it."""
    rng = random.Random(seed)
    img = Image.new("L", PHOTO_SIZE, 252)
    draw = ImageDraw.Draw(img)
    fields, y = [], 70

    for key, line, _ in invoice_lines(spec):
        size = 40 if line == "INVOICE" else 22
        font = _font(size, bold=key in ("vendor", "total") or line == "INVOICE")
        draw.text((60, y), line, font=font, fill=25)

        if key:
            value = field_value(key, spec)
            prefix = line[: line.rindex(value)] if value and value in line else ""
            x0 = 60 + draw.textlength(prefix, font=font)
            x1 = x0 + draw.textlength(value, font=font)
            box = [x0, y, x1, y + size]
            fields.append({
                "field": key, "text": value,
                "bbox": rotate_box(box, skew, PHOTO_SIZE) if skew else [round(v, 1) for v in box],
            })
        y += size + 14

    if skew:
        img = img.rotate(skew, resample=Image.BICUBIC, fillcolor=252)
    if uneven:
        grad = Image.linear_gradient("L").resize(PHOTO_SIZE).rotate(20, fillcolor=128)
        img = Image.blend(img, Image.composite(img, grad, img.point(lambda v: 255 if v > 200 else 0)), 0.3)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    noise = Image.frombytes("L", PHOTO_SIZE, bytes(rng.randrange(246, 256) for _ in range(PHOTO_SIZE[0] * PHOTO_SIZE[1])))
    return Image.blend(img, noise, 0.05).convert("RGB"), fields


DOCS = [
    # name, spec, how it is delivered, the classes it exists to cover
    ("digital-continental.pdf",
     dict(vendor="Northwind Paper Supply SL", invoice_no="NW-2026-0117", date="14 March 2026",
          convention="latin", subtotal=43290, vat_minor=9091, total_minor=52381),
     "pdf", ["digital", "continental"]),
    ("digital-anglo.pdf",
     dict(vendor="Harborlight Trading Ltd", invoice_no="HL-2026-4471", date="02 April 2026",
          convention="anglo", subtotal=43290, vat_minor=9091, total_minor=52381),
     "pdf", ["digital", "anglo"]),
    ("digital-wrong-total.pdf",
     dict(vendor="Verdant Office Group", invoice_no="VO-2026-0088", date="19 April 2026",
          convention="latin", subtotal=43290, vat_minor=9091, total_minor=61200),
     "pdf", ["digital", "arithmetic-wrong"]),
    ("digital-absent-vat.pdf",
     dict(vendor="Kestrel Print Works", invoice_no="KP-2026-0231", date="27 April 2026",
          convention="anglo", subtotal=43290, vat_minor=None, total_minor=43290),
     "pdf", ["digital", "absent-field"]),
    ("scan-continental.pdf",
     dict(vendor="Solent Paper Company", invoice_no="SP-2026-1902", date="05 May 2026",
          convention="latin", subtotal=118400, vat_minor=24864, total_minor=143264),
     "scan", ["scan", "continental"]),
    ("scan-anglo.pdf",
     dict(vendor="Ridgeway Supplies Inc", invoice_no="RW-2026-3310", date="11 May 2026",
          convention="anglo", subtotal=118400, vat_minor=24864, total_minor=143264),
     "scan", ["scan", "anglo"]),
    ("photo-skewed.png",
     dict(vendor="Lanternfield Stationers", invoice_no="LF-2026-0771", date="18 May 2026",
          convention="latin", subtotal=249116, vat_minor=52314, total_minor=301430),
     "photo", ["photo", "continental"]),
    ("photo-fragmented.png",
     dict(vendor="Ashgrove Paper Mill", invoice_no="AG-2026-0654", date="23 May 2026",
          convention="latin", subtotal=145900, vat_minor=30639, total_minor=176539),
     "photo", ["photo", "fragmented"]),
    ("photo-anglo.png",
     dict(vendor="Cobblestone Office Ltd", invoice_no="CS-2026-8123", date="29 May 2026",
          convention="anglo", subtotal=249116, vat_minor=52314, total_minor=301430),
     "photo", ["photo", "anglo"]),
]


def main():
    os.makedirs(CORPUS, exist_ok=True)
    truth = {}

    for index, (name, spec, mode, classes) in enumerate(DOCS):
        out = os.path.join(CORPUS, name)
        if mode == "pdf":
            fields = draw_pdf(out, spec)
        elif mode == "scan":
            img, fields = draw_image(spec, skew=0.6, seed=index)
            img.save(out, "PDF", resolution=SCAN_DPI)
            for f in fields:
                f["bbox"] = [round(v * SCAN_FACTOR, 1) for v in f["bbox"]]
        else:
            img, fields = draw_image(spec, skew=2.4, uneven=True, seed=index)
            img.save(out)
        # The full printed text, so a region can be classified as a real reading or a
        # misread. Field-level truth alone can only detect a value in the wrong place, never
        # a confident piece of nonsense, which is the failure that matters most here.
        page_text = " ".join(line for _, line, _ in invoice_lines(spec) if line)
        truth[name] = {"classes": classes, "mode": mode, "page_text": page_text, "fields": fields}

    with open(os.path.join(CORPUS, "notes.txt"), "w", encoding="utf-8") as fh:
        fh.write("Not a document. The walk must skip this file.\n")
    truth["notes.txt"] = {"classes": ["non-document"], "mode": "skip", "fields": []}

    with open(os.path.join(CORPUS, "truth.json"), "w", encoding="utf-8") as fh:
        json.dump(truth, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    for name in sorted(truth):
        n = len(truth[name]["fields"])
        size = os.path.getsize(os.path.join(CORPUS, name))
        print(f"{name:28} {size:>10,} bytes  {n} fields  {','.join(truth[name]['classes'])}")


if __name__ == "__main__":
    main()
