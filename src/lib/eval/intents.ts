/**
 * The benchmark's 100 seeded buyer intents. Fixed lists, no randomness: the
 * same 100 sessions run every time so two eval runs are comparable.
 *
 * 60 in-scope gift/handloom requests across ₹500–₹5,000, 25 vague
 * "kuch achha sa gift" requests, 15 boundary budgets sitting exactly on a
 * price, a cap or a policy threshold.
 */

export type IntentKind = "in_scope" | "vague" | "boundary";

export interface Intent {
  id: string;
  kind: IntentKind;
  text: string;
  budget_paise: number;
  scope: string[];
}

export const INTENT_SCOPE = ["handloom", "gifts"] as const;

const rupees = (n: number): number => n * 100;

/** [text, budget in rupees] */
const IN_SCOPE: ReadonlyArray<readonly [string, number]> = [
  ["Cotton saree gift for my mom", 2000],
  ["A saree for Diwali, something festive", 3000],
  ["Brass diyas for the office", 1000],
  ["Dupatta under 1500", 1500],
  ["Stole for a winter gift", 800],
  ["Anniversary gift for my wife, handloom please", 2500],
  ["Phulkari dupatta for my sister's wedding", 2000],
  ["Silk saree for a wedding", 5000],
  ["Zari saree for a festive evening", 3000],
  ["Handwoven stole for my friend", 1000],
  ["Gift set of diyas for pooja", 700],
  ["Daily wear cotton saree", 1800],
  ["Blouse piece to match a pastel saree", 500],
  ["Birthday gift for maa, a saree would be nice", 2000],
  ["Something handloom for my nani", 1500],
  ["Banarasi saree for the bride", 5000],
  ["Light stole in earthy tones", 900],
  ["Brass diya sets for Diwali gifting", 1200],
  ["Dupatta for a friend's engagement", 1500],
  ["Wedding gift for bhabhi, budget 3000", 3000],
  ["Cotton handloom saree in pastel shades", 1600],
  ["Phulkari dupatta as a birthday present", 1400],
  ["Festive saree with a golden border", 3500],
  ["Engraved brass diyas in a gift box", 600],
  ["Winter stole for dadi", 750],
  ["Handloom saree for my mother-in-law", 2200],
  ["Saree and blouse for an anniversary", 2000],
  ["Diwali gift for the neighbours, diyas", 550],
  ["Patiala phulkari dupatta", 1300],
  ["Gift for my wife, something in silk", 5000],
  ["Pastel cotton saree for everyday wear", 1500],
  ["Matching blouse fabric for a cotton saree", 400],
  ["Handwoven stole as a thank-you gift", 700],
  ["Festive gift for mummy, saree preferred", 3000],
  ["Zari border saree for Karva Chauth", 3200],
  ["Diya gift set for a housewarming", 800],
  ["Dupatta for my didi's birthday", 1500],
  ["Saree for amma, soft cotton", 1700],
  ["Stole for my friend who loves handloom", 900],
  ["Brass diyas for the Diwali pooja", 1000],
  ["Cotton saree for a colleague's farewell gift", 2000],
  ["Banarasi silk for a wedding guest", 5000],
  ["Elegant saree with zari for a reception", 3000],
  ["Dupatta with embroidery for a gift", 1400],
  ["Handloom stole, earthy colours", 1000],
  ["Gift box of diyas for clients", 900],
  ["Cotton saree for my mother's birthday", 2000],
  ["Saree gift for my patni", 2500],
  ["Phulkari dupatta for a wedding gift", 2000],
  ["Festive diyas, brass, in a gift box", 650],
  ["Blouse piece in a matching shade", 450],
  ["Saree for the office party", 2000],
  ["Stole for a winter birthday", 1000],
  ["Handloom saree for Diwali", 2800],
  ["Silk saree for my sister's shaadi", 5000],
  ["Dupatta to gift my bhabhi", 1500],
  ["Cotton saree, daily wear, pastel", 1600],
  ["Diya set for the temple at home", 700],
  ["Zari saree for a festive gift", 3400],
  ["Handwoven stole for a colleague", 800],
];

const VAGUE: ReadonlyArray<readonly [string, number]> = [
  ["kuch achha sa gift", 2000],
  ["Something nice for my sister", 1500],
  ["koi accha tohfa 2000 tak", 2000],
  ["kuch achha sa gift for mummy", 2500],
  ["Something special for my mom", 2000],
  ["kuch bhi achha, gift hai", 1000],
  ["A nice present for a friend", 1200],
  ["koi achha sa tohfa for didi", 1500],
  ["Something good for Diwali gifting", 1500],
  ["kuch achha sa gift, budget 1000", 1000],
  ["Something nice for my wife", 3000],
  ["ek accha sa uphaar for nani", 1800],
  ["kuch achha sa gift for the office", 800],
  ["Something special for our anniversary", 2500],
  ["koi accha sa gift, 500 tak", 500],
  ["Something nice for bhabhi", 2000],
  ["kuch achha sa gift for a wedding", 4000],
  ["A good gift for my mother", 2000],
  ["kuch achha sa present for dost", 900],
  ["Something nice for maa, festive", 3000],
  ["koi accha tohfa for a colleague", 1000],
  ["kuch achha sa gift for my daughter", 1500],
  ["Something special for dadi", 1200],
  ["ek achha sa gift 1500 tak", 1500],
  ["kuch achha sa gift for a housewarming", 1000],
];

/** Budgets that sit exactly on a list price, a bundle total, a cap or the gate. */
const BOUNDARY: ReadonlyArray<readonly [string, number]> = [
  ["Brass diya gift set", 499],
  ["Brass diya gift set", 500],
  ["Handwoven stole", 648],
  ["Handwoven stole", 649],
  ["Diya gift set with a stole", 1148],
  ["Phulkari dupatta", 1299],
  ["Cotton handloom saree", 1498],
  ["Cotton handloom saree", 1499],
  ["Cotton saree with a matching blouse", 1849],
  ["Cotton saree with a matching blouse", 1850],
  ["Zari border saree", 2799],
  ["Banarasi silk saree", 4999],
  ["Banarasi silk saree", 5000],
  ["Banarasi silk saree for a wedding", 5001],
  ["Banarasi silk saree for a wedding", 10000],
];

function build(kind: IntentKind, prefix: string, rows: ReadonlyArray<readonly [string, number]>): Intent[] {
  return rows.map(([text, budget], i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    kind,
    text,
    budget_paise: rupees(budget),
    scope: [...INTENT_SCOPE],
  }));
}

/** Deterministic generator: the same lists always produce the same 100 intents. */
export function generateIntents(): Intent[] {
  return [...build("in_scope", "in", IN_SCOPE), ...build("vague", "vg", VAGUE), ...build("boundary", "bd", BOUNDARY)];
}

export const INTENTS: readonly Intent[] = generateIntents();

export const INTENT_COUNTS: Record<IntentKind, number> = { in_scope: 60, vague: 25, boundary: 15 };
