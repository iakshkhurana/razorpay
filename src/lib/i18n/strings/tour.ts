import { dict } from "../core";

/**
 * The Grand Tour overlay: chrome strings plus the ten captions in Hindi.
 * English captions live in lib/tour/steps.ts (the merchant-facing script);
 * the Hindi lines here mirror them step for step. ₹ amounts and stamp names
 * stay as written.
 */
export const tour = dict({
  en: {
    "tour.label": "Grand Tour",
    "tour.progress": "Tour progress",
    "tour.stepOf": "Step {{n}} of {{total}}",
    "tour.complete": "Grand Tour · complete",
    "tour.endSub": "Every rupee your AI sells — explained, bounded, and written down.",
    "tour.back": "Back",
    "tour.next": "Next",
    "tour.restart": "Restart tour",
    "tour.close": "Close tour",
    "tour.closeTitle": "Close tour (Esc)",
    "tour.autoplay": "Plays itself · Esc to leave",
    "caption.1": "This is AgentGate. Watch the book write itself.",
    "caption.2": "Ramesh ji pastes his messy catalog.",
    "caption.3": "AI drafted the rulebook. Ramesh ji approves it — humans set the rules.",
    "caption.4": "An AI buyer arrives with a ₹2,000 mandate.",
    "caption.5": "The seller agent upsells a blouse — ₹1,849, inside every rule.",
    "caption.6": "Money moved. The book already explains why.",
    "caption.7": "₹5,000 try on a ₹2,000 mandate — COUNTER, not crash.",
    "caption.8": "Big order? The owner decides. AI never does.",
    "caption.9": "Bank failed the payment. Order HELD, backup link issued — gracefully.",
    "caption.10": "Not vibes — measured. 0 breaches across 40 attacks.",
    "end.card": "Har paisa, likha hua.",
  },
  hi: {
    "tour.label": "ग्रैंड टूर",
    "tour.progress": "टूर की प्रगति",
    "tour.stepOf": "{{total}} में से कदम {{n}}",
    "tour.complete": "ग्रैंड टूर · पूरा",
    "tour.endSub": "आपका AI जो भी रुपया बेचे — समझाया हुआ, सीमा में, और लिखा हुआ।",
    "tour.back": "पीछे",
    "tour.next": "अगला",
    "tour.restart": "टूर फिर शुरू करें",
    "tour.close": "टूर बंद करें",
    "tour.closeTitle": "टूर बंद करें (Esc)",
    "tour.autoplay": "अपने आप चलता है · निकलने के लिए Esc",
    "caption.1": "यह है AgentGate। देखिए, बही-खाता खुद लिखता है।",
    "caption.2": "रमेश जी अपना बिखरा हुआ कैटलॉग चिपकाते हैं।",
    "caption.3": "AI ने नियम-पुस्तिका का मसौदा बनाया। रमेश जी मंज़ूरी देते हैं — नियम इंसान तय करते हैं।",
    "caption.4": "एक AI खरीदार ₹2,000 के मैंडेट के साथ आता है।",
    "caption.5": "विक्रेता एजेंट ब्लाउज़ का अपसेल करता है — ₹1,849, हर नियम के भीतर।",
    "caption.6": "पैसा चला। बही-खाता पहले से बताता है क्यों।",
    "caption.7": "₹2,000 के मैंडेट पर ₹5,000 की कोशिश — जवाबी ऑफ़र, क्रैश नहीं।",
    "caption.8": "बड़ा ऑर्डर? फ़ैसला मालिक का। AI कभी नहीं।",
    "caption.9": "बैंक ने भुगतान विफल किया। ऑर्डर रोका गया, बैकअप लिंक जारी — शालीनता से।",
    "caption.10": "अंदाज़ा नहीं — नापा हुआ। 40 हमलों में 0 सेंध।",
    "end.card": "हर पैसा, लिखा हुआ।",
  },
});

export type TourKey = keyof typeof tour.en;
