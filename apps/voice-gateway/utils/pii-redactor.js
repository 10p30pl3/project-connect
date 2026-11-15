'use strict';

/**
 * Redação de PII (LGPD / PCI-DSS) aplicada às transcrições e resumos de chamadas.
 */

function luhnCheck(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function redactPii(text, enabled = true) {
  if (!enabled || !text) return text;
  let out = String(text);
  // CPF: 000.000.000-00 ou 11 dígitos próximos a contexto de CPF
  out = out.replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, '$1.***.***-$4');
  // CNPJ
  out = out.replace(/\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g, '$1.***.***/****-$5');
  // Cartões (13-19 dígitos com espaços/traços validados por Luhn)
  out = out.replace(/\b(?:\d[\s-]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      return `**** **** **** ${digits.slice(-4)}`;
    }
    return m;
  });
  // CVV explícito
  out = out.replace(/\b(cvv|código de segurança)\s*[:é]?\s*(\d{3,4})\b/gi, '$1 ***');
  return out;
}

module.exports = { redactPii, luhnCheck };
