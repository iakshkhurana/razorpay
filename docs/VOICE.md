# Voice pipeline

Both agents can talk and listen, in English and Hindi. Voice is a layer over the product, never inside the money path — if anything here fails, the demo continues silently.

## Speaking (TTS)

```
seller reply / day summary
  → toSpeakable()        strip URLs, ids, hashes, emoji, markdown; "₹1,849" → "1,849 rupees/rupaye"
  → splitSentences()     sentence chunks (handles the Devanagari danda ।; merges tiny fragments)
  → /api/tts             Sarvam bulbul:v3 (speaker priya, pace 0.95) → WAV
  → pipelined playback   chunk i plays while i+1 synthesizes
```

- **Never reads machine text.** The sanitizer drops `http(s)://…`, bare domains, `ord_/off_/mnd_/plink_…` ids and hex hashes before anything reaches a voice — and the seller's house rules tell it to say "the payment link below", never the raw value.
- **Language follows the script.** Devanagari text speaks as `hi-IN`, Latin as `en-IN` — likho hindi → bolo hindi.
- **Fallback chain.** No Sarvam key, or any upstream trouble → `404 { fallback: "browser" }` → the browser's own `speechSynthesis` takes over. No key, no network, still a talking demo.

## Listening (STT)

```
mic (MediaRecorder) → /api/stt → Sarvam saarika:v2.5 → { transcript, language_code }
                       └─ fallback: the browser's own recognizer (webkitSpeechRecognition)
```

- **Consent first.** The first mic press anywhere asks once, plainly; the choice is stored locally (`agentgate.mic.consent`) and shared by every mic on the site. Declining hides nothing else — typing always works.
- **Barge‑in.** Starting to speak stops the agent's playback immediately; the floor is yours.
- **Buyer loop.** On the simulator, a transcript auto‑sends as the buyer's message, so speak → verdict → spoken reply is one motion.
- **Onboarding by voice.** A Hinglish utterance ("discount 5% se zyada mat dena") becomes a JSON patch against the draft policy — applied to the sliders, confirmed aloud. Voice edits policy *before* approval; it can never touch a live money action.

## Why it feels natural

- The day summary is written as a munim would say it — a greeting, the news, the reassurance — not a stats dump.
- Sentence‑chunked synthesis keeps first audio fast and pacing human.
- Numbers are spoken in words ("1,849 rupaye"), never as symbol soup.
