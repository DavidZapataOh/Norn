"""Writes purchase-order files for the import tests.

Every vendor and reference is invented. The files are written byte-exactly, including the
byte order mark and the CRLF line endings, because that is what the importer is being asked
to survive. Run: python3 scripts/make-records.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RECORDS = os.path.join(HERE, "..", "fixtures", "records")

# One ledger, written two ways. The test asserts the two produce identical integers, which
# is the property that matters: a European export and an Anglo one describe the same money.
LEDGER = [
    ("PO-2026-0001", "Northwind Paper Supply SL", 123450, "EUR", "14 March 2026"),
    ("PO-2026-0002", "Harborlight Trading Ltd", 9900, "GBP", "02 April 2026"),
    ("PO-2026-0003", "Solent Paper Company", 500000, "EUR", "11 May 2026"),
    ("PO-2026-0004", "Kestrel Print Works", 43290, "EUR", "27 April 2026"),
]


def anglo(minor):
    """No thousands grouping: the Anglo group separator is the comma, which is the delimiter
    of the file this goes into. A real exporter writing CSV drops the grouping for the same
    reason."""
    units, cents = divmod(minor, 100)
    return f"{units}.{cents:02d}"


def latin(minor):
    units, cents = divmod(minor, 100)
    return f"{units:,}".replace(",", ".") + f",{cents:02d}"


def write(name, text, encoding="utf-8"):
    path = os.path.join(RECORDS, name)
    with open(path, "wb") as fh:
        fh.write(text.encode(encoding))
    return os.path.getsize(path)


# One record per corpus document, with the amount derived from the corpus's own ground truth
# rather than typed a second time: a change to a document must not silently turn an exact
# match into a one-cent mismatch. The deviation is then applied to that derived value.
DEVIATIONS = {
    "digital-continental.pdf": ("exact", 0, "matched",
                                "the record is the amount the document prints"),
    "digital-anglo.pdf": ("two cents under, inside tolerance", -2, "matched",
                          "two minor units is inside the stated tolerance"),
    "scan-continental.pdf": ("one euro under", -100, "mismatch",
                             "one euro under, well outside tolerance"),
    "photo-skewed.png": ("ten times the amount", "x10", "mismatch",
                         "a wrong magnitude, the failure that looks most plausible"),
    "photo-anglo.png": ("different currency", "currency", "mismatch",
                        "a different currency is a hard stop and nothing converts"),
    "scan-anglo.pdf": ("inactive vendor", "inactive", "mismatch",
                       "the vendor is marked inactive"),
    "photo-fragmented.png": ("no record at all", None, "no-candidate",
                             "no record was imported for this document"),
    "digital-wrong-total.pdf": ("arithmetic already wrong", 0, "indeterminate",
                                "the gate withheld the amount, so it cannot be compared"),
}

# A currency the corpus never uses, so the mismatch cannot pass by coincidence.
OTHER_CURRENCY = "USD"


def parse_minor(text):
    """The corpus prints an amount in one of two conventions. This is the same rule the
    application's parser applies, kept here because a fixture generator that imported the
    application would be checking the application against itself."""
    body = text.strip().split()[-1]
    if "," in body and "." in body:
        decimal = "," if body.rindex(",") > body.rindex(".") else "."
    else:
        decimal = "," if "," in body and len(body.split(",")[-1]) <= 2 else "."
    units, _, cents = body.rpartition(decimal)
    units = units.replace(".", "").replace(",", "") or "0"
    return int(units) * 100 + int(cents or 0)


def write_reconcile_set():
    corpus = os.path.join(HERE, "..", "fixtures", "corpus", "truth.json")
    with open(corpus, encoding="utf-8") as fh:
        truth = json.load(fh)

    lines = ["reference;vendor;amount;currency;date"]
    expected = {}

    for name, (label, deviation, verdict, why) in DEVIATIONS.items():
        fields = {f["field"]: f for f in truth[name]["fields"]}
        minor = parse_minor(fields["total"]["text"])
        currency = fields["currency"]["text"]
        vendor = fields["vendor"]["text"]
        reference = fields["invoice_no"]["text"]

        expected[name] = {"verdict": verdict, "why": why, "deviation": label}
        if deviation == "inactive":
            # Marked in the store rather than encoded in the name: a renamed vendor still
            # matches by reference and is never actually inactive, so the check under test
            # would never run.
            expected[name]["deactivateVendor"] = vendor

        if deviation is None:
            continue   # no record at all, on purpose
        if deviation == "x10":
            minor *= 10
        elif deviation == "currency":
            currency = OTHER_CURRENCY
        elif deviation == "inactive":
            pass
        else:
            minor += deviation

        units, cents = divmod(minor, 100)
        lines.append(f"{reference};{vendor};{units}.{cents:02d};{currency};14 March 2026")

    text = "\r\n".join(lines) + "\r\n"
    size = write("reconcile.csv", text)

    path = os.path.join(RECORDS, "expected.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(expected, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    for name in sorted(expected):
        e = expected[name]
        print(f"  {name:26} {e['verdict']:14} {e['deviation']}")
    return size, os.path.getsize(path)


def main():
    os.makedirs(RECORDS, exist_ok=True)
    written = {}

    rows = "".join(f"{r},{v},{anglo(m)},{c},{d}\n" for r, v, m, c, d in LEDGER)
    written["orders-comma.csv"] = write(
        "orders-comma.csv", "reference,vendor,amount,currency,date\n" + rows)

    rows = "".join(f"{r};{v};{latin(m)};{c};{d}\r\n" for r, v, m, c, d in LEDGER)
    written["orders-semicolon.csv"] = write(
        "orders-semicolon.csv", "reference;vendor;amount;currency;date\r\n" + rows)

    rows = "".join(f"{r},{v},{anglo(m)},{c},{d}\n" for r, v, m, c, d in LEDGER)
    written["orders-bom.csv"] = write(
        "orders-bom.csv", "\ufeff" + "reference,vendor,amount,currency,date\n" + rows)

    # A vendor name carrying the delimiter and an escaped quote. Semicolon-delimited so the
    # quoted commas are the only commas that matter to the count.
    quoted = (
        'reference;vendor;amount;currency;date\r\n'
        'PO-2026-0001;"Northwind Paper, SL";1.234,50;EUR;14 March 2026\r\n'
        'PO-2026-0002;"Harborlight ""The Yard"" Ltd";99,00;GBP;02 April 2026\r\n'
        'PO-2026-0003;"Solent Paper, Print, and Board";5.000,00;EUR;11 May 2026\r\n'
        'PO-2026-0004;Kestrel Print Works;432,90;EUR;27 April 2026\r\n'
    )
    written["orders-quoted.csv"] = write("orders-quoted.csv", quoted)

    broken = (
        "reference,vendor,amount,currency,date\n"
        "PO-2026-0001,Northwind Paper Supply SL,1234.50,EUR,14 March 2026\n"
        "PO-2026-0002,Harborlight Trading Ltd,not a number,GBP,02 April 2026\n"
        "PO-2026-0003,Solent Paper Company,5000.00,,11 May 2026\n"
        "PO-2026-0001,Northwind Paper Supply SL,432.90,EUR,27 April 2026\n"
    )
    written["orders-broken.csv"] = write("orders-broken.csv", broken)

    wrong = (
        "col_a,col_b,col_c\n"
        "x,y,1234.50\n"
        "x,y,99.00\n"
    )
    written["orders-wrong-columns.csv"] = write("orders-wrong-columns.csv", wrong)

    # Latin-1: the accented letter becomes a single byte no UTF-8 decoder will take.
    path = os.path.join(RECORDS, "orders-latin1.csv")
    with open(path, "wb") as fh:
        fh.write("reference,vendor,amount,currency,date\n".encode("utf-8"))
        fh.write("PO-2026-0001,Almacén Central,1234.50,EUR,14 March 2026\n".encode("latin-1"))
    written["orders-latin1.csv"] = os.path.getsize(path)

    written["reconcile.csv"], written["expected.json"] = write_reconcile_set()

    for name in sorted(written):
        print(f"{name:28} {written[name]:>7,} bytes")


if __name__ == "__main__":
    main()
