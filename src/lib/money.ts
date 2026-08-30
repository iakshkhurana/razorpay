/**
 * Money helpers. Every amount in the system is an integer number of paise.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Indian digit grouping: 1234567 -> "12,34,567" */
export function groupIndian(n: number): string {
  const s = Math.abs(Math.trunc(n)).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${grouped},${last3}`;
}

/** Format paise as "₹1,849" (whole rupees) or "₹1,849.50" when paise remain. */
export function formatINR(paise: number, opts: { showPaise?: boolean } = {}): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = groupIndian(rupees);
  if (opts.showPaise || rem !== 0) {
    return `${sign}₹${body}.${rem.toString().padStart(2, "0")}`;
  }
  return `${sign}₹${body}`;
}

export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
