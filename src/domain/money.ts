declare const audBrand: unique symbol;

/** Whole Australian dollars. */
export type Aud = number & { readonly [audBrand]: true };

export function aud(dollars: number): Aud {
  if (!Number.isSafeInteger(dollars) || dollars < 0) {
    throw new RangeError(`Expected whole, non-negative dollars, got ${dollars}`);
  }
  return dollars as Aud;
}

const formatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});

/** "A$810,000", or "about A$810,000" for indicative figures. */
export function formatAud(amount: Aud, { approx = false } = {}): string {
  const text = formatter.format(amount).replace(/^AUD\s?/u, "A$");
  return approx ? `about ${text}` : text;
}
