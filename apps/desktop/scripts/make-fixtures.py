"""Writes synthetic documents for the reading tests.

Every value is invented and every tax identifier is plainly fake. The files are
generated rather than committed so the corpus is reproducible and reviewable as
source. Run: python3 scripts/make-fixtures.py
"""

import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "fixtures", "docs")

MAX_PDF_BYTES = 25 * 1024 * 1024

INVOICE = [
    ("INVOICE", 22, True),
    ("Northwind Paper Supply SL", 12, True),
    ("Calle Mayor 14, 28013 Madrid", 10, False),
    ("VAT ID: ES-X0000000X (fake)", 10, False),
    ("", 10, False),
    ("Bill to: Acme Robotics GmbH", 11, True),
    ("Invoice no. NW-2024-0117", 10, False),
    ("Issue date: 14 March 2024", 10, False),
    ("Due date: 13 April 2024", 10, False),
    ("", 10, False),
    ("Description                 Qty     Unit      Amount", 10, True),
    ("A4 copier paper, 80 g/m2     40     8.20     328.00", 10, False),
    ("Recycled card stock, A3      12     6.75      81.00", 10, False),
    ("Delivery, next day            1    23.90      23.90", 10, False),
    ("", 10, False),
    ("Subtotal                                     432.90", 10, False),
    ("VAT 21%                                       90.91", 10, False),
    ("Total due                                    523.81", 12, True),
    ("", 10, False),
    ("Payment to IBAN ES00 0000 0000 0000 0000 0000 (fake)", 9, False),
]


def _font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def digital_pdf(path):
    c = canvas.Canvas(path, pagesize=A4)
    y = A4[1] - 70
    for line, size, bold in INVOICE:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(56, y, line)
        y -= size + 8
    c.showPage()
    c.save()


def scan_image(width=1240, height=1754, skew=0.0, uneven=False, seed=7):
    """Renders the invoice as pixels, the way a flatbed or a phone would deliver it."""
    rng = random.Random(seed)
    img = Image.new("L", (width, height), 252)
    draw = ImageDraw.Draw(img)
    y = 90
    for line, size, bold in INVOICE:
        px = int(size * 2.6)
        draw.text((80, y), line, font=_font(px, bold), fill=25)
        y += px + 18

    if skew:
        img = img.rotate(skew, resample=Image.BICUBIC, fillcolor=252, expand=False)

    if uneven:
        # A phone photo is lit from one side; a flat threshold on the result loses a
        # corner, which is what the recognition stage has to survive.
        grad = Image.linear_gradient("L").resize((width, height)).rotate(20, fillcolor=128)
        img = Image.blend(img, Image.composite(img, grad, img.point(lambda v: 255 if v > 200 else 0)), 0.35)

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    noise = Image.frombytes("L", (width, height), bytes(rng.randrange(246, 256) for _ in range(width * height)))
    return Image.blend(img, noise, 0.06).convert("RGB")


def scanned_pdf(path):
    scan_image(skew=0.7).save(path, "PDF", resolution=150.0)


def textpoor_pdf(path, scan_png):
    """An image page carrying the few characters a bad upstream OCR left behind."""
    c = canvas.Canvas(path, pagesize=A4)
    c.drawImage(scan_png, 0, 0, width=A4[0], height=A4[1])
    c.setFont("Helvetica", 6)
    c.drawString(40, 20, "1 / 1  scan")
    c.showPage()
    c.save()


def corrupt_pdf(path, source):
    """A valid header over a body pdf.js cannot follow."""
    with open(source, "rb") as fh:
        head = fh.read(9)
    rng = random.Random(11)
    body = bytes(rng.randrange(0, 256) for _ in range(4096))
    with open(path, "wb") as fh:
        fh.write(head + b"\n" + body)


def huge_pdf(path, source):
    """Padded past the byte ceiling with PDF comment lines after the trailer.

    Generating 25 MB of real pages would take minutes and prove nothing extra: the
    ceiling is checked from the file size before a byte is parsed.
    """
    with open(source, "rb") as fh:
        real = fh.read()
    filler = (b"%" + b"F" * 78 + b"\n") * 1024
    with open(path, "wb") as fh:
        fh.write(real)
        written = len(real)
        while written <= MAX_PDF_BYTES:
            fh.write(filler)
            written += len(filler)


def main():
    os.makedirs(DOCS, exist_ok=True)
    out = lambda n: os.path.join(DOCS, n)

    digital_pdf(out("invoice-digital.pdf"))
    scanned_pdf(out("invoice-scanned.pdf"))

    scan_png = out("_scan.png")
    scan_image(skew=0.7).save(scan_png)
    textpoor_pdf(out("invoice-textpoor.pdf"), scan_png)
    os.remove(scan_png)

    scan_image(width=900, height=1400, skew=2.2, uneven=True, seed=3).save(out("receipt-photo.png"))

    corrupt_pdf(out("invoice-corrupt.pdf"), out("invoice-digital.pdf"))
    huge_pdf(out("invoice-huge.pdf"), out("invoice-digital.pdf"))

    with open(out("notes.txt"), "w", encoding="utf-8") as fh:
        fh.write("Not a document the walk should pick up.\n")

    for name in sorted(os.listdir(DOCS)):
        size = os.path.getsize(out(name))
        print(f"{name:24} {size:>12,} bytes")


if __name__ == "__main__":
    main()
