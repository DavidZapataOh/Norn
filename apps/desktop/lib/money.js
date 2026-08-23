"use strict";

// The trailing guard is a lookahead rather than \b, because a recogniser fuses a code to
// its amount ("ARS2.831,40") and \b never fires between "S" and "2". Rejecting a following
// letter still keeps "ARSENAL" out, and lets the alternation prefer USDT over USD.
const CURRENCY = /\b(ARS|USD|USDT|EUR|BRL|CLP|COP|MXN|PEN|UYU|GBP|NOK|SEK|DKK|CHF|AUD|CAD)(?![A-Z])/i;
const SYMBOLS = { "R$": "BRL", "$": "USD", "€": "EUR", "£": "GBP" };

// BigInt rather than an integer Number: a sum over a large ledger can exceed the safe
// integer range in minor units, and that failure would be silent.
function parseAmount(raw, decimals = 2) {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let currency = null;
  const code = raw.match(CURRENCY);
  if (code) currency = code[1].toUpperCase();
  else for (const [symbol, iso] of Object.entries(SYMBOLS)) {
    if (raw.includes(symbol)) { currency = iso; break; }
  }

  const negative = /^\s*-/.test(raw);
  let body = raw.replace(CURRENCY, "");
  for (const symbol of Object.keys(SYMBOLS)) body = body.split(symbol).join("");
  body = body.replace(/^\s*-/, "").replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;

  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let intPart, fracPart, convention;

  if (lastDot === -1 && lastComma === -1) {
    intPart = body; fracPart = ""; convention = "integer";
  } else {
    // Whichever separator is last is the decimal one: a thousands separator is always
    // followed by exactly three digits.
    const sep = Math.max(lastDot, lastComma);
    const tail = body.slice(sep + 1);

    if (tail.length === 3 && (lastDot === -1 || lastComma === -1)) {
      // Three digits after the only separator is a thousands mark. The other reading
      // needs a three-decimal currency, which is out of scope.
      intPart = body.replace(/[.,]/g, "");
      fracPart = "";
      convention = sep === lastComma ? "latin" : "anglo";
    } else if (!/^\d{1,2}$/.test(tail)) {
      return null;
    } else {
      intPart = body.slice(0, sep).replace(/[.,]/g, "");
      fracPart = tail;
      convention = sep === lastComma ? "latin" : "anglo";
    }
  }

  if (!/^\d+$/.test(intPart)) return null;
  const scale = 10n ** BigInt(decimals);
  const frac = BigInt((fracPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  const minor = BigInt(intPart) * scale + frac;
  return { minor: negative ? -minor : minor, currency, convention };
}

function formatMinor(minor, decimals = 2) {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(decimals);
  return `${negative ? "-" : ""}${abs / scale}.${String(abs % scale).padStart(decimals, "0")}`;
}

module.exports = { parseAmount, formatMinor };
