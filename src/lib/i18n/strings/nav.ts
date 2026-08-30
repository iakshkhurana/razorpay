import { dict } from "../core";

/**
 * Chrome strings that `common` does not carry: mega-menu copy, the live test
 * pill, the sidebar rails card and the workspace switcher. Hindi is Devanagari
 * only; brand names (AgentGate, Razorpay, GPT-4o) and ₹ stay as written.
 */
export const nav = dict({
  en: {
    /* product panel */
    "product.eyebrow": "The product",
    "product.onboard.desc": "Paste a messy catalog, approve the rulebook, go live in two minutes.",
    "product.simulator.desc": "An AI buyer negotiates with your seller agent — every price stamped.",
    "product.tower.desc": "The living ledger, approvals and today's numbers in one view.",
    "product.evidence.desc": "40 attacks, 0 breaches — the scorecard, measured not claimed.",
    "product.tour.desc": "A ten-step walkthrough that runs itself on stage.",
    "product.rule": "The LLM never touches money.",
    "product.rule.desc": "Every money action passes a deterministic policy engine and lands in a hash-chained ledger.",

    /* solutions panel */
    "solutions.eyebrow": "Built for",
    "solutions.kirana": "Kirana & retail",
    "solutions.kirana.desc": "Sarees, gifts, groceries — bounded discounts, one upsell, owner approval above a limit.",
    "solutions.fuel": "Fuel & mobility",
    "solutions.fuel.desc": "Fleet agents refuel within a mandate; every litre priced and written down.",
    "solutions.more": "See both on the landing page",

    /* live test pill */
    "pill.razorpay": "Razorpay",
    "pill.mock": "Mock",
    "pill.checking": "Checking",
    "pill.title.razorpay": "Test mode — payments on Razorpay test rails, no real money moves",
    "pill.title.mock": "Test mode — payments on the local mock adapter, no real money moves",
    "pill.title.checking": "Test mode — reading the payment rail from /api/stats",

    /* sidebar rails card */
    "rails.mock": "Test mode · Mock rails",
    "rails.meter": "Money actions explained",
    "rails.ledger": "Ledger entries",
    "rails.chainOk": "Chain intact",
    "rails.chainBroken": "Chain broken",
    "rails.waiting": "Reading the shop…",

    /* workspace switcher */
    "workspace.current": "Current workspace",
    "workspace.addShop": "Onboard another shop",
    "workspace.addShop.desc": "A fresh catalog and rulebook, live in two minutes.",

    /* drawers */
    "drawer.open": "Open navigation",
    "drawer.close": "Close navigation",

    /* route loading */
    "progress.label": "Loading the next page",
  },
  hi: {
    "product.eyebrow": "प्रोडक्ट",
    "product.onboard.desc": "बिखरा हुआ कैटलॉग चिपकाएँ, नियम-पुस्तिका मंज़ूर करें, दो मिनट में लाइव।",
    "product.simulator.desc": "एक AI खरीदार आपके विक्रेता एजेंट से मोल-भाव करता है — हर दाम पर मुहर।",
    "product.tower.desc": "जीवंत बही-खाता, मंज़ूरियाँ और आज के आँकड़े एक ही जगह।",
    "product.evidence.desc": "40 हमले, 0 सेंध — स्कोरकार्ड, दावा नहीं, नापा हुआ।",
    "product.tour.desc": "दस कदमों की सैर जो मंच पर खुद चलती है।",
    "product.rule": "LLM कभी पैसे को नहीं छूता।",
    "product.rule.desc": "हर धन-कार्य एक निश्चित नीति-इंजन से गुज़रता है और हैश-श्रृंखला वाले बही-खाते में दर्ज होता है।",

    "solutions.eyebrow": "इनके लिए बना",
    "solutions.kirana": "किराना और रिटेल",
    "solutions.kirana.desc": "साड़ी, उपहार, किराना — सीमित छूट, एक अपसेल, सीमा से ऊपर मालिक की मंज़ूरी।",
    "solutions.fuel": "ईंधन और मोबिलिटी",
    "solutions.fuel.desc": "फ़्लीट एजेंट मैंडेट के भीतर ईंधन भरते हैं; हर लीटर का दाम लिखा हुआ।",
    "solutions.more": "दोनों लैंडिंग पेज पर देखें",

    "pill.razorpay": "Razorpay",
    "pill.mock": "मॉक",
    "pill.checking": "जाँच जारी",
    "pill.title.razorpay": "टेस्ट मोड — भुगतान Razorpay टेस्ट रेल्स पर, असली पैसा नहीं चलता",
    "pill.title.mock": "टेस्ट मोड — भुगतान लोकल मॉक अडैप्टर पर, असली पैसा नहीं चलता",
    "pill.title.checking": "टेस्ट मोड — /api/stats से भुगतान रेल पढ़ी जा रही है",

    "rails.mock": "टेस्ट मोड · मॉक रेल्स",
    "rails.meter": "समझाए गए धन-कार्य",
    "rails.ledger": "बही-खाते की प्रविष्टियाँ",
    "rails.chainOk": "श्रृंखला अखंड",
    "rails.chainBroken": "श्रृंखला टूटी",
    "rails.waiting": "दुकान पढ़ी जा रही है…",

    "workspace.current": "वर्तमान वर्कस्पेस",
    "workspace.addShop": "एक और दुकान जोड़ें",
    "workspace.addShop.desc": "नया कैटलॉग और नियम-पुस्तिका, दो मिनट में लाइव।",

    "drawer.open": "नेविगेशन खोलें",
    "drawer.close": "नेविगेशन बंद करें",

    "progress.label": "अगला पेज लोड हो रहा है",
  },
});

export type NavKey = keyof typeof nav.en;
