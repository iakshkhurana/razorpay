"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { VoiceMic } from "@/components/VoiceMic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, sleep, type OnboardResponse } from "@/lib/demo/client";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import type { Policy, Sku } from "@/lib/schemas";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Step = "catalog" | "review";
type PolicyKey = keyof Policy;

const DEFAULT_MERCHANT = "Ramesh Handlooms";
const NETWORK_ERROR = "Could not reach the shop. Check that the app is running and try again.";
const NOT_UNDERSTOOD = "Samajh nahi aaya, dobara boliye.";

interface DraftInput {
  csv: string;
  url: string;
  merchant_name: string;
  utterance: string;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function fetchSampleCsv(): Promise<string> {
  const res = await fetch("/api/onboard/sample", { cache: "no-store" });
  if (!res.ok) throw new Error("sample unavailable");
  const data = (await res.json()) as { ok?: boolean; csv?: string };
  if (!data.ok || typeof data.csv !== "string") throw new Error("sample unavailable");
  return data.csv;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The review table, written back as CSV so a voice edit can re-run onboarding on the same catalog. */
function skusToCsv(skus: Sku[]): string {
  const lines = ["name,description,price_inr,stock,category,tags"];
  for (const s of skus) {
    lines.push(
      [s.name, s.description, String(paiseToRupees(s.price_paise)), String(s.stock), s.category, s.tags.join(",")].map(csvField).join(","),
    );
  }
  return lines.join("\n");
}

function patchWords(patch: Partial<Policy>): string[] {
  const words: string[] = [];
  if (patch.price_floor_pct !== undefined) words.push(`minimum price ${patch.price_floor_pct}%`);
  if (patch.max_discount_pct !== undefined) words.push(`maximum discount ${patch.max_discount_pct}%`);
  if (patch.max_qty_per_order !== undefined) words.push(`max ${patch.max_qty_per_order} items per order`);
  if (patch.gate_above_paise !== undefined) words.push(`ask me above ${formatINR(patch.gate_above_paise)}`);
  if (patch.max_order_value_paise !== undefined) words.push(`biggest order ${formatINR(patch.max_order_value_paise)}`);
  if (patch.category_allowlist !== undefined) words.push(`sell only ${patch.category_allowlist.join(", ") || "nothing"}`);
  if (patch.refund_policy !== undefined) words.push(`returns: ${patch.refund_policy}`);
  return words;
}

function patchKeys(patch: Partial<Policy>): PolicyKey[] {
  return (Object.keys(patch) as PolicyKey[]).filter((k) => patch[k] !== undefined);
}

function speak(text: string): void {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("hi"));
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  } catch {
    /* voice is a convenience, never a requirement */
  }
}

/** Trims the table before it goes live; null when a row has no name. */
function cleanSkus(skus: Sku[]): Sku[] | null {
  const out: Sku[] = [];
  for (const s of skus) {
    const name = s.name.trim();
    if (!name) return null;
    out.push({
      ...s,
      name,
      image_emoji: s.image_emoji.trim() || "🛍️",
      price_paise: Math.max(0, Math.round(s.price_paise)),
      stock: Math.max(0, Math.round(s.stock)),
      category: s.category.trim().toLowerCase() || "general",
    });
  }
  return out.length > 0 ? out : null;
}

const SOURCE_LABEL: Record<OnboardResponse["source"], string> = {
  csv: "from your CSV",
  url: "from your store page",
  llm: "read off your store page",
  fallback: "from the sample catalog",
};

const FALLBACK_NOTE = "We could not read products from what you gave us, so this is the sample catalog. Edit these rows, or go back and paste a CSV with name and price columns.";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function OnboardPage() {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("catalog");
  const [merchantName, setMerchantName] = useState(DEFAULT_MERCHANT);
  const [storeUrl, setStoreUrl] = useState("");
  const [csv, setCsv] = useState("");
  const [utterance, setUtterance] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<OnboardResponse["source"] | null>(null);

  const [skus, setSkus] = useState<Sku[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [highlight, setHighlight] = useState<Set<PolicyKey>>(() => new Set());

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  /* mirrors `step` synchronously so a queued tour action sees a draft that has not rendered yet */
  const stepRef = useRef<Step>("catalog");

  const goToStep = useCallback((next: Step) => {
    stepRef.current = next;
    setStep(next);
  }, []);

  /* ---- highlight a slider after a voice edit ---------------------- */

  const flash = useCallback((keys: PolicyKey[]) => {
    if (keys.length === 0) return;
    setHighlight(new Set(keys));
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setHighlight(new Set()), 1800);
  }, []);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  /* ---- step 1: catalog --------------------------------------------- */

  const loadSample = useCallback(async (): Promise<string | null> => {
    setSampleLoading(true);
    setDraftError(null);
    try {
      const text = await fetchSampleCsv();
      setCsv(text);
      return text;
    } catch {
      setDraftError("Could not load the sample catalog. Paste a CSV with name and price columns instead.");
      return null;
    } finally {
      setSampleLoading(false);
    }
  }, []);

  const readFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setCsv(text);
      setDraftError(null);
    } catch {
      setDraftError(`Could not read ${file.name}. Paste the CSV text instead.`);
    }
  }, []);

  const draftShop = useCallback(async (input: DraftInput): Promise<boolean> => {
    const csvText = input.csv.trim();
    const url = normalizeUrl(input.url);
    if (!csvText && !url) {
      setDraftError("Paste a CSV or enter a store URL first. The sample catalog works too.");
      return false;
    }
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await api.onboard({
        csv: csvText || undefined,
        url: url || undefined,
        merchant_name: input.merchant_name.trim() || undefined,
        voice_utterance: input.utterance.trim() || undefined,
      });
      if (!res.skus || res.skus.length === 0) {
        setDraftError("No products found. Paste a CSV with name and price columns.");
        return false;
      }
      setSkus(res.skus);
      setPolicy(res.policy);
      setDraftSource(res.source);
      setMerchantName(res.merchant_name || input.merchant_name || DEFAULT_MERCHANT);
      setConfirmError(null);
      if (res.voice) {
        const keys = patchKeys(res.voice.patch);
        setVoiceNote(keys.length > 0 ? `Set: ${patchWords(res.voice.patch).join(", ")}` : res.voice.spoken_confirmation || NOT_UNDERSTOOD);
        flash(keys);
        speak(res.voice.spoken_confirmation);
      } else {
        setVoiceNote(null);
      }
      goToStep("review");
      return true;
    } catch (err) {
      setDraftError(messageFor(err, NETWORK_ERROR));
      return false;
    } finally {
      setDrafting(false);
    }
  }, [flash, goToStep]);

  /* ---- step 2: review ---------------------------------------------- */

  const categories = useMemo(() => {
    const set = new Set<string>();
    skus.forEach((s) => set.add(s.category.trim().toLowerCase()));
    (policy?.category_allowlist ?? []).forEach((c) => set.add(c.trim().toLowerCase()));
    return [...set].filter(Boolean).sort();
  }, [skus, policy]);

  const updateSku = useCallback((index: number, patch: Partial<Sku>) => {
    setSkus((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

  const setPolicyField = useCallback(<K extends PolicyKey>(key: K, value: Policy[K]) => {
    setPolicy((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setPolicy((prev) => {
      if (!prev) return prev;
      const on = prev.category_allowlist.includes(category);
      const category_allowlist = on ? prev.category_allowlist.filter((c) => c !== category) : [...prev.category_allowlist, category];
      return { ...prev, category_allowlist };
    });
  }, []);

  const onReviewTranscript = useCallback(
    async (text: string) => {
      if (!policy || live) return;
      setVoiceBusy(true);
      setVoiceNote(`Suna: “${text}”`);
      try {
        const res = await api.onboard({
          csv: csv.trim() || skusToCsv(skus),
          merchant_name: merchantName.trim() || undefined,
          voice_utterance: text,
        });
        const voice = res.voice;
        if (!voice) {
          setVoiceNote(NOT_UNDERSTOOD);
          return;
        }
        const keys = patchKeys(voice.patch);
        if (keys.length > 0) {
          const patch = voice.patch;
          setPolicy((prev) => (prev ? { ...prev, ...patch } : prev));
          setVoiceNote(`Set: ${patchWords(patch).join(", ")}`);
        } else {
          setVoiceNote(voice.spoken_confirmation || NOT_UNDERSTOOD);
        }
        flash(keys);
        speak(voice.spoken_confirmation);
      } catch (err) {
        setVoiceNote(messageFor(err, "Could not reach the shop. Your sliders are unchanged — try again or drag them."));
      } finally {
        setVoiceBusy(false);
      }
    },
    [policy, live, csv, skus, merchantName, flash],
  );

  const approve = useCallback(async (): Promise<boolean> => {
    if (!policy || live) return false;
    const cleaned = cleanSkus(skus);
    if (!cleaned) {
      setConfirmError("Every product needs a name before the shop goes live. Fill the empty name in the table.");
      return false;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await api.confirmPolicy({ merchant_name: merchantName.trim() || DEFAULT_MERCHANT, skus: cleaned, policy });
      setSkus(cleaned);
      setLive(true);
      toast("Dukaan live hai ✓", "money");
      return true;
    } catch (err) {
      setConfirmError(messageFor(err, NETWORK_ERROR));
      return false;
    } finally {
      setConfirming(false);
    }
  }, [policy, live, skus, merchantName, toast]);

  /* ---- Grand Tour ---------------------------------------------------- */

  const latest = useRef({ live, merchantName, approve });
  useEffect(() => {
    latest.current = { live, merchantName, approve };
  });

  const runTourAction = useCallback(
    async (action: TourEventDetail["action"]) => {
      const draftFromSample = async (): Promise<boolean> => {
        const sample = await loadSample();
        if (!sample) return false;
        return draftShop({ csv: sample, url: "", merchant_name: latest.current.merchantName, utterance: "" });
      };

      if (action === "onboard:autofill") {
        if (stepRef.current === "review") return;
        await draftFromSample();
        return;
      }
      if (action === "onboard:review") {
        if (latest.current.live) return;
        if (stepRef.current !== "review") {
          const ok = await draftFromSample();
          if (!ok) return;
        }
        await sleep(900);
        await latest.current.approve();
      }
    },
    [loadSample, draftShop],
  );

  const tourChain = useRef<Promise<void>>(Promise.resolve());
  const onTour = useCallback(
    (detail: TourEventDetail) => {
      if (!isTourActive()) return;
      if (detail.action !== "onboard:autofill" && detail.action !== "onboard:review") return;
      const action = detail.action;
      tourChain.current = tourChain.current.then(() => runTourAction(action)).catch(() => undefined);
    },
    [runTourAction],
  );
  useTourAction(onTour);

  /* ---- render ------------------------------------------------------- */

  const allowlistEmpty = policy !== null && policy.category_allowlist.length === 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-ink/70">
              Onboarding · {step === "catalog" ? "Catalog" : "Review & rules"}
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Apni dukaan AI buyers ke liye kholiye.</h1>
            <p className="mt-2 max-w-xl text-ink/65">
              Paste your catalog, check the rulebook, go live. Nothing sells until you approve it — and every sale gets written in the book.
            </p>
          </div>
          <nav aria-label="Onboarding progress" className="flex items-center gap-2 text-sm">
            <span
              aria-current={step === "catalog" ? "step" : undefined}
              className={cn("rounded-full border px-3 py-1", step === "catalog" ? "border-action bg-action text-paper" : "border-ink/15 text-ink/70")}
            >
              Catalog
            </span>
            <span aria-hidden="true" className="text-ink/30">
              →
            </span>
            <span
              aria-current={step === "review" ? "step" : undefined}
              className={cn("rounded-full border px-3 py-1", step === "review" ? "border-action bg-action text-paper" : "border-ink/15 text-ink/70")}
            >
              Review & rules
            </span>
          </nav>
        </div>

        {step === "catalog" ? (
          <form
            className="max-w-3xl"
            onSubmit={(e) => {
              e.preventDefault();
              void draftShop({ csv, url: storeUrl, merchant_name: merchantName, utterance });
            }}
          >
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Your shop</CardTitle>
                  <CardDescription className="text-ink/70">Naam, website (optional) aur catalog. A CSV with name and price columns is enough.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="merchant-name">Shop name</Label>
                    <Input
                      id="merchant-name"
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                      placeholder={DEFAULT_MERCHANT}
                      autoComplete="organization"
                    />
                  </div>
                  <div>
                    <Label htmlFor="store-url">
                      Store URL <span className="font-normal text-ink/70">(optional)</span>
                    </Label>
                    <Input
                      id="store-url"
                      value={storeUrl}
                      onChange={(e) => setStoreUrl(e.target.value)}
                      placeholder="https://your-shop.example"
                      inputMode="url"
                      autoComplete="url"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <Label htmlFor="catalog-csv" className="mb-0">
                      Catalog CSV
                    </Label>
                    <button
                      type="button"
                      onClick={() => void loadSample()}
                      disabled={sampleLoading || drafting}
                      aria-busy={sampleLoading}
                      className="text-sm font-medium text-action underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Use Ramesh ji’s sample catalog
                    </button>
                  </div>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!dragOver) setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      void readFile(e.dataTransfer.files?.[0]);
                    }}
                    className={cn("rounded-xl border border-dashed p-2 transition-colors", dragOver ? "border-action bg-action/5" : "border-ink/15")}
                  >
                    <Textarea
                      id="catalog-csv"
                      value={csv}
                      onChange={(e) => setCsv(e.target.value)}
                      rows={9}
                      spellCheck={false}
                      placeholder={"name,price,stock,category\nCotton Handloom Saree,1499,15,handloom\nBrass Diya Gift Set,499,25,gifts"}
                      className="min-h-[180px] border-transparent bg-transparent focus:border-transparent"
                    />
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 pt-2 text-xs text-ink/70">
                      <span>Drop a .csv file here, or</span>
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="font-medium text-action underline-offset-4 hover:underline"
                      >
                        choose a file
                      </button>
                      <span>from your computer.</span>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".csv,text/csv,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          void readFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                </div>

                <VoiceMic
                  onTranscript={(text) => setUtterance(text)}
                  disabled={drafting}
                  className="rounded-xl border border-ink/10 bg-paper/70 p-4"
                />
                {utterance ? (
                  <p className="text-sm text-ink/80" aria-live="polite">
                    Suna: <span className="italic">“{utterance}”</span> — yeh rule draft mein jud jayega.{" "}
                    <button type="button" onClick={() => setUtterance("")} className="text-action underline-offset-4 hover:underline">
                      Hatao
                    </button>
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <Button type="submit" size="lg" loading={drafting} disabled={drafting || sampleLoading}>
                    Draft my shop
                  </Button>
                  {draftError ? (
                    <p className="text-sm text-deny" role="alert">
                      {draftError}
                    </p>
                  ) : (
                    <p className="text-sm text-ink/70">AI reads the catalog and drafts your rulebook. You approve it next.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </form>
        ) : null}

        {step === "review" && policy ? (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Catalog</CardTitle>
                    <CardDescription className="text-ink/70">
                      {skus.length} {skus.length === 1 ? "product" : "products"} {draftSource ? SOURCE_LABEL[draftSource] : "drafted"}. Edit anything before
                      going live.
                    </CardDescription>
                    {draftSource === "fallback" ? <p className="mt-2 text-sm text-turmeric">{FALLBACK_NOTE}</p> : null}
                  </div>
                  {!live ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => goToStep("catalog")} disabled={confirming}>
                      Back to catalog
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.12em] text-ink/70">
                          <th scope="col" className="pb-2 pr-2 font-medium">
                            Emoji
                          </th>
                          <th scope="col" className="pb-2 pr-2 font-medium">
                            Name
                          </th>
                          <th scope="col" className="pb-2 pr-2 font-medium">
                            Category
                          </th>
                          <th scope="col" className="pb-2 pr-2 text-right font-medium">
                            Price ₹
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium">
                            Stock
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink/5">
                        {skus.map((s, i) => (
                          <tr key={s.id}>
                            <td className="py-1.5 pr-2">
                              <Input
                                aria-label={`Emoji for ${s.name || "product"}`}
                                value={s.image_emoji}
                                onChange={(e) => updateSku(i, { image_emoji: e.target.value })}
                                disabled={live}
                                className="w-14 px-1 text-center text-lg"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <Input
                                aria-label={`Name of product ${i + 1}`}
                                value={s.name}
                                onChange={(e) => updateSku(i, { name: e.target.value })}
                                disabled={live}
                                className="min-w-[180px]"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <Badge tone={policy.category_allowlist.includes(s.category) ? "action" : "ink"}>{s.category}</Badge>
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="decimal"
                                aria-label={`Price in rupees for ${s.name || "product"}`}
                                value={paiseToRupees(s.price_paise)}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  updateSku(i, { price_paise: Number.isFinite(n) && n >= 0 ? rupeesToPaise(n) : 0 });
                                }}
                                disabled={live}
                                className="w-28 text-right font-mono tnum"
                              />
                            </td>
                            <td className="py-1.5 text-right">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                aria-label={`Stock for ${s.name || "product"}`}
                                value={s.stock}
                                onChange={(e) => {
                                  const n = Number.parseInt(e.target.value, 10);
                                  updateSku(i, { stock: Number.isFinite(n) && n >= 0 ? n : 0 });
                                }}
                                disabled={live}
                                className="w-20 text-right font-mono tnum"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-ink/70">
                    Prices are list prices in rupees. Categories outside the rulebook’s allowlist stay in the catalog but cannot be sold to AI buyers.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Rulebook</CardTitle>
                    <CardDescription className="text-ink/70">AI ne draft kiya, aap approve karo. The policy engine enforces every line — the AI never decides.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <RuleRow highlighted={highlight.has("price_floor_pct")}>
                    <Slider
                      id="price-floor"
                      label="Minimum price protection"
                      value={policy.price_floor_pct}
                      min={50}
                      max={100}
                      format={(v) => `${v}%`}
                      onChange={(v) => setPolicyField("price_floor_pct", v)}
                      hint="Buyers cannot push a price below this share of the list price."
                    />
                  </RuleRow>
                  <RuleRow highlighted={highlight.has("max_discount_pct")}>
                    <Slider
                      id="max-discount"
                      label="Maximum discount"
                      value={policy.max_discount_pct}
                      min={0}
                      max={50}
                      format={(v) => `${v}%`}
                      onChange={(v) => setPolicyField("max_discount_pct", v)}
                      hint="The most the seller agent may take off any offer."
                    />
                  </RuleRow>
                  <RuleRow highlighted={highlight.has("max_qty_per_order")}>
                    <Slider
                      id="max-qty"
                      label="Max items per order"
                      value={policy.max_qty_per_order}
                      min={1}
                      max={10}
                      onChange={(v) => setPolicyField("max_qty_per_order", v)}
                    />
                  </RuleRow>
                  <RuleRow highlighted={highlight.has("gate_above_paise")}>
                    <Slider
                      id="gate-above"
                      label="Ask me above"
                      value={policy.gate_above_paise}
                      min={100_000}
                      max={5_000_000}
                      step={50_000}
                      format={(v) => formatINR(v)}
                      onChange={(v) => setPolicyField("gate_above_paise", v)}
                      hint="Orders above this wait for your approval in the Control Tower."
                    />
                  </RuleRow>
                  <RuleRow highlighted={highlight.has("max_order_value_paise")}>
                    <Slider
                      id="max-order"
                      label="Biggest order allowed"
                      value={policy.max_order_value_paise}
                      min={100_000}
                      max={20_000_000}
                      step={50_000}
                      format={(v) => formatINR(v)}
                      onChange={(v) => setPolicyField("max_order_value_paise", v)}
                      hint="Anything larger is refused outright."
                    />
                  </RuleRow>

                  <RuleRow highlighted={highlight.has("category_allowlist")} className="pt-3">
                    <p className="mb-2 text-sm font-medium text-ink/80">Categories AI buyers may buy</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Category allowlist">
                      {categories.map((c) => {
                        const on = policy.category_allowlist.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={on}
                            disabled={live}
                            onClick={() => toggleCategory(c)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                              on ? "border-action bg-action text-paper" : "border-ink/20 bg-transparent text-ink/70 hover:border-ink/40",
                            )}
                          >
                            {on ? "✓ " : ""}
                            {c}
                          </button>
                        );
                      })}
                    </div>
                    <p className={cn("mt-2 text-xs", allowlistEmpty ? "text-deny" : "text-ink/70")}>
                      {allowlistEmpty
                        ? "No category is on — AI buyers cannot buy anything. Turn one on to sell."
                        : "Off means an AI buyer asking for it gets a polite DENY and an in-scope alternative."}
                    </p>
                  </RuleRow>

                  <RuleRow highlighted={highlight.has("refund_policy")} className="pt-3">
                    <Label htmlFor="refund-policy">Return policy</Label>
                    <Input
                      id="refund-policy"
                      value={policy.refund_policy}
                      onChange={(e) => setPolicyField("refund_policy", e.target.value)}
                      disabled={live}
                      placeholder="7-day easy returns on unused items."
                    />
                  </RuleRow>
                </CardContent>
              </Card>
            </div>

            <section aria-label="Go live" className="mt-6 rounded-xl border border-ink/10 bg-white/60 p-5">
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <VoiceMic
                    label="Boliye: 'discount 5% se zyada mat dena' — rulebook awaaz se badlega."
                    onTranscript={(text) => void onReviewTranscript(text)}
                    disabled={voiceBusy || live || confirming}
                  />
                  <p className="mt-2 min-h-[1.25rem] text-sm text-ink/75" aria-live="polite">
                    {voiceBusy ? "Samajh raha hoon…" : voiceNote}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-3 md:items-end">
                  <Button type="button" size="lg" onClick={() => void approve()} loading={confirming} disabled={live || confirming}>
                    {live ? "Live ✓" : "Approve & go live"}
                  </Button>
                  {confirmError ? (
                    <p className="max-w-sm text-sm text-deny md:text-right" role="alert">
                      {confirmError}
                    </p>
                  ) : null}
                </div>
              </div>

              {live ? (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <p className="text-sm text-money">
                    {merchantName.trim() || DEFAULT_MERCHANT} is live. AI buyers can now shop inside these rules — every action gets written in the book.
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm font-medium">
                    <Link href="/simulator" className="text-action underline-offset-4 hover:underline">
                      Open the simulator
                    </Link>
                    <Link href="/dashboard" className="text-action underline-offset-4 hover:underline">
                      Open Control Tower
                    </Link>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

function RuleRow({ highlighted, className, children }: { highlighted: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn("-mx-2 rounded-lg px-2 transition-colors", highlighted && "bg-turmeric/10", className)}>{children}</div>;
}
