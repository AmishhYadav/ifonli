/** "1299" / "1,299.50" -> paise, or null if it is not a valid rupee amount. */
export function rupeesToPaiseStrict(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const paiseToRupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
