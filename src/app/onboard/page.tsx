"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/AppShell";
import { FloatingCard, Storefront } from "@/components/illustrations";
import { VoiceMic } from "@/components/VoiceMic";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, sleep, type OnboardResponse } from "@/lib/demo/client";
import { useT, type Translator } from "@/lib/i18n/core";
import { onboard, type OnboardKey } from "@/lib/i18n/strings/onboard";
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

function patchWords(patch: Partial<Policy>, t: Translator<OnboardKey>): string[] {
  const words: string[] = [];
  if (patch.price_floor_pct !== undefined) words.push(t("words.floor", { pct: patch.price_floor_pct }));
  if (patch.max_discount_pct !== undefined) words.push(t("words.discount", { pct: patch.max_discount_pct }));
  if (patch.max_qty_per_order !== undefined) words.push(t("words.qty", { n: patch.max_qty_per_order }));
  if (patch.gate_above_paise !== undefined) words.push(t("words.gate", { amount: formatINR(patch.gate_above_paise) }));
  if (patch.max_order_value_paise !== undefined) words.push(t("words.maxOrder", { amount: formatINR(patch.max_order_value_paise) }));
  if (patch.category_allowlist !== undefined) words.push(t("words.categories", { list: patch.category_allowlist.join(", ") || t("words.nothing") }));
  if (patch.refund_policy !== undefined) words.push(t("words.refund", { text: patch.refund_policy }));
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

const SOURCE_LABEL: Record<OnboardResponse["source"], OnboardKey> = {
  csv: "source.csv",
  url: "source.url",
  llm: "source.llm",
  fallback: "source.fallback",
};

const ERROR_TEXT = "text-[#B3262C]";

/* Table inputs that read as cells: quiet until hovered or focused. */
const CELL =
  "h-9 rounded-lg border-transparent bg-transparent px-2 shadow-none hover:border-rzp-border hover:bg-rzp-mist " +
  "focus:border-rzp-blue focus:bg-white disabled:cursor-default disabled:bg-transparent disabled:text-rzp-text";

const NEXT_STEPS: readonly OnboardKey[] = ["next.1", "next.2", "next.3"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function OnboardPage() {
  const { toast } = useToast();
  const t = useT(onboard);
  /** stable handle for callbacks that outlive a render */
  const tRef = useRef(t);
  tRef.current = t;

  const [step, setStep] = useState<Step>("catalog");
  const [merchantName, setMerchantName] = useState(DEFAULT_MERCHANT);
  const [storeUrl, setStoreUrl] = useState("");
  const [csv, setCsv] = useState("");
  const [utterance, setUtterance] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
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
  const photoInput = useRef<HTMLInputElement | null>(null);
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
      setDraftError(tRef.current("error.sample"));
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
      setDraftError(tRef.current("error.file", { name: file.name }));
    }
  }, []);

  /** A bill or price-list photo → catalog rows via the vision route; fills the CSV box. */
  const readPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setPhotoNote({ tone: "err", text: tRef.current("photo.tooBig") });
      return;
    }
    setPhotoBusy(true);
    setPhotoNote(null);
    setDraftError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/onboard/vision", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; csv?: string; count?: number } | null;
      if (res.status === 501) {
        setPhotoNote({ tone: "err", text: tRef.current("photo.unavailable") });
        return;
      }
      if (!res.ok || !data?.ok || typeof data.csv !== "string") {
        setPhotoNote({ tone: "err", text: tRef.current("photo.error") });
        return;
      }
      setCsv(data.csv);
      setPhotoNote({ tone: "ok", text: tRef.current("photo.done", { count: data.count ?? 0 }) });
    } catch {
      setPhotoNote({ tone: "err", text: tRef.current("photo.error") });
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const draftShop = useCallback(async (input: DraftInput): Promise<boolean> => {
    const csvText = input.csv.trim();
    const url = normalizeUrl(input.url);
    if (!csvText && !url) {
      setDraftError(tRef.current("error.needInput"));
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
        setDraftError(tRef.current("error.noProducts"));
        return false;
      }
      setSkus(res.skus);
      setPolicy(res.policy);
      setDraftSource(res.source);
      setMerchantName(res.merchant_name || input.merchant_name || DEFAULT_MERCHANT);
      setConfirmError(null);
      if (res.voice) {
        const keys = patchKeys(res.voice.patch);
        setVoiceNote(
          keys.length > 0
            ? tRef.current("voice.set", { words: patchWords(res.voice.patch, tRef.current).join(", ") })
            : res.voice.spoken_confirmation || tRef.current("voice.notUnderstood"),
        );
        flash(keys);
        speak(res.voice.spoken_confirmation);
      } else {
        setVoiceNote(null);
      }
      goToStep("review");
      return true;
    } catch (err) {
      setDraftError(messageFor(err, tRef.current("error.network")));
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
      setVoiceNote(tRef.current("voice.heard", { text }));
      try {
        const res = await api.onboard({
          csv: csv.trim() || skusToCsv(skus),
          merchant_name: merchantName.trim() || undefined,
          voice_utterance: text,
        });
        const voice = res.voice;
        if (!voice) {
          setVoiceNote(tRef.current("voice.notUnderstood"));
          return;
        }
        const keys = patchKeys(voice.patch);
        if (keys.length > 0) {
          const patch = voice.patch;
          setPolicy((prev) => (prev ? { ...prev, ...patch } : prev));
          setVoiceNote(tRef.current("voice.set", { words: patchWords(patch, tRef.current).join(", ") }));
        } else {
          setVoiceNote(voice.spoken_confirmation || tRef.current("voice.notUnderstood"));
        }
        flash(keys);
        speak(voice.spoken_confirmation);
      } catch (err) {
        setVoiceNote(messageFor(err, tRef.current("voice.error")));
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
      setConfirmError(tRef.current("error.needName"));
      return false;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await api.confirmPolicy({ merchant_name: merchantName.trim() || DEFAULT_MERCHANT, skus: cleaned, policy });
      setSkus(cleaned);
      setLive(true);
      toast(tRef.current("toast.live"), "money");
      return true;
    } catch (err) {
      setConfirmError(messageFor(err, tRef.current("error.network")));
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
  const allowedCount = policy ? skus.filter((s) => policy.category_allowlist.includes(s.category)).length : 0;
  const shopName = merchantName.trim() || DEFAULT_MERCHANT;

  const headerActions =
    step === "review" ? (
      live ? (
        <Badge tone="green" dot className="h-8 px-3 text-sm">
          {t("golive.liveButton")}
        </Badge>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => goToStep("catalog")} disabled={confirming}>
          {t("action.back")}
        </Button>
      )
    ) : undefined;

  return (
    <AppShell
      section="onboard"
      title={t("page.title")}
      subtitle={t("page.subtitle")}
      actions={headerActions}
      headerExtra={<Stepper step={step} live={live} />}
    >
      {step === "catalog" && drafting ? <DraftingSkeleton /> : null}

      {step === "catalog" && !drafting ? (
        <form
          className="fade-up"
          onSubmit={(e) => {
            e.preventDefault();
            void draftShop({ csv, url: storeUrl, merchant_name: merchantName, utterance });
          }}
        >
          <Card elevated className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="p-5 sm:p-7">
                <div className="mb-5">
                  <h2 className="font-display text-xl font-semibold tracking-tight text-rzp-text">{t("shop.title")}</h2>
                  <p className="mt-1 text-sm text-rzp-muted">{t("shop.subtitle")}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="merchant-name">{t("field.name")}</Label>
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
                      {t("field.url")} <span className="font-normal text-rzp-muted">{t("field.optional")}</span>
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

                <div className="mt-5">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <Label htmlFor="catalog-csv" className="mb-0">
                      {t("field.csv")}
                    </Label>
                    <button
                      type="button"
                      onClick={() => void loadSample()}
                      disabled={sampleLoading || drafting}
                      aria-busy={sampleLoading}
                      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sampleLoading ? <Spinner className="h-3.5 w-3.5" /> : <SparkIcon className="h-3.5 w-3.5" />}
                      {t("sample.load")}
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
                    className={cn(
                      "relative overflow-hidden rounded-2xl border-2 border-dashed p-3 transition-colors duration-150",
                      "focus-within:border-rzp-blue focus-within:bg-white",
                      dragOver ? "border-rzp-blue bg-rzp-blue/5" : "border-rzp-border bg-rzp-mist/70",
                    )}
                  >
                    <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 -right-6 w-52 opacity-[0.16] sm:w-64">
                      <FloatingCard className="w-full" />
                    </div>
                    <Textarea
                      id="catalog-csv"
                      value={csv}
                      onChange={(e) => setCsv(e.target.value)}
                      rows={9}
                      spellCheck={false}
                      placeholder={t("csv.placeholder")}
                      className="relative z-[1] min-h-[200px] border-transparent bg-transparent shadow-none hover:border-transparent focus:border-transparent focus:ring-0"
                    />
                    <div className="relative z-[1] flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 pt-2 text-xs text-rzp-muted">
                      <UploadIcon className="h-4 w-4 text-rzp-blueDeep" />
                      <span>{t("drop.text1")}</span>
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="rounded-sm font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-1"
                      >
                        {t("drop.choose")}
                      </button>
                      <span>{t("drop.text2")}</span>
                      <span>{t("photo.or")}</span>
                      <button
                        type="button"
                        onClick={() => photoInput.current?.click()}
                        disabled={photoBusy || drafting}
                        aria-busy={photoBusy}
                        className="inline-flex items-center gap-1 rounded-sm font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {photoBusy ? <Spinner className="h-3 w-3" /> : null}
                        {photoBusy ? t("photo.busy") : t("photo.button")}
                      </button>
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
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          void readPhoto(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                  {photoNote ? (
                    <p className={cn("mt-2 text-sm", photoNote.tone === "err" ? ERROR_TEXT : "text-rzp-text")} aria-live="polite" role={photoNote.tone === "err" ? "alert" : undefined}>
                      {photoNote.text}
                    </p>
                  ) : null}
                </div>

                <VoiceMic
                  onTranscript={(text) => setUtterance(text)}
                  disabled={drafting}
                  className="mt-5 rounded-2xl border border-rzp-border bg-rzp-mist p-4"
                />
                {utterance ? (
                  <p className="mt-3 text-sm text-rzp-text" aria-live="polite">
                    {t("heard.prefix")} <span className="italic">“{utterance}”</span> {t("heard.note")}{" "}
                    <button
                      type="button"
                      onClick={() => setUtterance("")}
                      className="rounded-sm font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-1"
                    >
                      {t("heard.remove")}
                    </button>
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <Button type="submit" size="lg" loading={drafting} disabled={drafting || sampleLoading}>
                    {t("submit.draft")}
                  </Button>
                  {draftError ? (
                    <p className={cn("text-sm", ERROR_TEXT)} role="alert">
                      {draftError}
                    </p>
                  ) : (
                    <p className="text-sm text-rzp-muted">{t("submit.hint")}</p>
                  )}
                </div>
              </div>

              <aside className="relative hidden border-l border-rzp-border bg-rzp-mist2 bg-dots lg:flex lg:flex-col lg:items-center lg:justify-center lg:p-6">
                <Storefront className="w-full max-w-[250px]" title={t("storefront.alt")} />
                <p className="mt-4 self-stretch text-[11px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">{t("next.title")}</p>
                <ol className="mt-2 space-y-2 self-stretch text-sm text-rzp-text">
                  {NEXT_STEPS.map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-rzp-blueDeep" />
                      <span>{t(line)}</span>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          </Card>
        </form>
      ) : null}

      {step === "review" && policy ? (
        <div className="fade-up space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
            {/* ---- SKU table ------------------------------------------ */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t("catalog.title")}</CardTitle>
                  <CardDescription>
                    {t("catalog.count", {
                      count: skus.length,
                      noun: t(skus.length === 1 ? "catalog.product" : "catalog.products"),
                      source: t(draftSource ? SOURCE_LABEL[draftSource] : "source.drafted"),
                    })}
                  </CardDescription>
                  {draftSource === "fallback" ? <p className="mt-2 text-sm text-[#9A4F00]">{t("fallback.note")}</p> : null}
                </div>
                <Badge tone={allowedCount > 0 ? "blue" : "amber"} className="shrink-0">
                  {t("sellable", { allowed: allowedCount, total: skus.length })}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="scrollbar-thin -mx-2 overflow-x-auto px-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-rzp-muted">
                        <th scope="col" className="pb-2 pl-2 pr-2 font-semibold">
                          {t("th.product")}
                        </th>
                        <th scope="col" className="pb-2 pr-2 font-semibold">
                          {t("th.category")}
                        </th>
                        <th scope="col" className="pb-2 pr-2 text-right font-semibold">
                          {t("th.price")}
                        </th>
                        <th scope="col" className="pb-2 pr-2 text-right font-semibold">
                          {t("th.stock")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rzp-border">
                      {skus.map((s, i) => (
                        <tr key={s.id} className="transition-colors hover:bg-rzp-mist/60">
                          <td className="py-1 pr-2">
                            <div className="flex items-center gap-1">
                              <Input
                                aria-label={t("cell.emoji", { name: s.name || t("cell.product") })}
                                value={s.image_emoji}
                                onChange={(e) => updateSku(i, { image_emoji: e.target.value })}
                                disabled={live}
                                className={cn(CELL, "w-12 px-1 text-center text-lg")}
                              />
                              <Input
                                aria-label={t("cell.name", { n: i + 1 })}
                                value={s.name}
                                onChange={(e) => updateSku(i, { name: e.target.value })}
                                disabled={live}
                                aria-invalid={s.name.trim() ? undefined : true}
                                className={cn(CELL, "min-w-[180px] font-medium")}
                              />
                            </div>
                          </td>
                          <td className="py-1 pr-2">
                            <Badge tone={policy.category_allowlist.includes(s.category) ? "blue" : "gray"}>{s.category}</Badge>
                          </td>
                          <td className="py-1 pr-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="decimal"
                              aria-label={t("cell.price", { name: s.name || t("cell.product") })}
                              value={paiseToRupees(s.price_paise)}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                updateSku(i, { price_paise: Number.isFinite(n) && n >= 0 ? rupeesToPaise(n) : 0 });
                              }}
                              disabled={live}
                              className={cn(CELL, "w-28 text-right font-mono tnum")}
                            />
                          </td>
                          <td className="py-1 pr-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="numeric"
                              aria-label={t("cell.stock", { name: s.name || t("cell.product") })}
                              value={s.stock}
                              onChange={(e) => {
                                const n = Number.parseInt(e.target.value, 10);
                                updateSku(i, { stock: Number.isFinite(n) && n >= 0 ? n : 0 });
                              }}
                              disabled={live}
                              className={cn(CELL, "w-20 text-right font-mono tnum")}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-rzp-muted">{t("catalog.note")}</p>
              </CardContent>
            </Card>

            {/* ---- Rulebook ------------------------------------------- */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t("rulebook.title")}</CardTitle>
                  <CardDescription>{t("rulebook.subtitle")}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="mb-3 flex flex-wrap gap-2" aria-label={t("rulebook.summary")}>
                  <Badge tone="blue" dot>
                    {t("pill.floor", { pct: policy.price_floor_pct })}
                  </Badge>
                  <Badge tone="blue" dot>
                    {t("pill.discount", { pct: policy.max_discount_pct })}
                  </Badge>
                  <Badge tone="violet" dot>
                    {t("pill.gate", { amount: formatINR(policy.gate_above_paise) })}
                  </Badge>
                  <Badge tone="gray" dot>
                    {policy.max_qty_per_order === 1 ? t("pill.qtyOne") : t("pill.qty", { n: policy.max_qty_per_order })}
                  </Badge>
                </div>

                <RuleRow highlighted={highlight.has("price_floor_pct")}>
                  <Slider
                    id="price-floor"
                    label={t("rule.floor.label")}
                    value={policy.price_floor_pct}
                    min={50}
                    max={100}
                    format={(v) => `${v}%`}
                    onChange={(v) => setPolicyField("price_floor_pct", v)}
                    hint={t("rule.floor.hint")}
                    disabled={live}
                  />
                </RuleRow>
                <RuleRow highlighted={highlight.has("max_discount_pct")}>
                  <Slider
                    id="max-discount"
                    label={t("rule.discount.label")}
                    value={policy.max_discount_pct}
                    min={0}
                    max={50}
                    format={(v) => `${v}%`}
                    onChange={(v) => setPolicyField("max_discount_pct", v)}
                    hint={t("rule.discount.hint")}
                    disabled={live}
                  />
                </RuleRow>
                <RuleRow highlighted={highlight.has("max_qty_per_order")}>
                  <Slider
                    id="max-qty"
                    label={t("rule.qty.label")}
                    value={policy.max_qty_per_order}
                    min={1}
                    max={10}
                    onChange={(v) => setPolicyField("max_qty_per_order", v)}
                    disabled={live}
                  />
                </RuleRow>
                <RuleRow highlighted={highlight.has("gate_above_paise")}>
                  <Slider
                    id="gate-above"
                    label={t("rule.gate.label")}
                    value={policy.gate_above_paise}
                    min={100_000}
                    max={5_000_000}
                    step={50_000}
                    format={(v) => formatINR(v)}
                    onChange={(v) => setPolicyField("gate_above_paise", v)}
                    hint={t("rule.gate.hint")}
                    disabled={live}
                  />
                </RuleRow>
                <RuleRow highlighted={highlight.has("max_order_value_paise")}>
                  <Slider
                    id="max-order"
                    label={t("rule.maxOrder.label")}
                    value={policy.max_order_value_paise}
                    min={100_000}
                    max={20_000_000}
                    step={50_000}
                    format={(v) => formatINR(v)}
                    onChange={(v) => setPolicyField("max_order_value_paise", v)}
                    hint={t("rule.maxOrder.hint")}
                    disabled={live}
                  />
                </RuleRow>

                <RuleRow highlighted={highlight.has("category_allowlist")} className="pt-3">
                  <p className="mb-2 text-sm font-medium text-rzp-text">{t("rule.categories.label")}</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t("rule.categories.aria")}>
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
                            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            on ? "border-rzp-blue bg-rzp-blue text-white hover:bg-rzp-blueHover" : "border-rzp-border bg-white text-rzp-muted hover:border-rzp-blue hover:text-rzp-blueDeep",
                          )}
                        >
                          {on ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  <p className={cn("mt-2 text-xs", allowlistEmpty ? ERROR_TEXT : "text-rzp-muted")}>
                    {allowlistEmpty ? t("rule.categories.empty") : t("rule.categories.off")}
                  </p>
                </RuleRow>

                <RuleRow highlighted={highlight.has("refund_policy")} className="pt-3">
                  <Label htmlFor="refund-policy">{t("rule.refund.label")}</Label>
                  <Input
                    id="refund-policy"
                    value={policy.refund_policy}
                    onChange={(e) => setPolicyField("refund_policy", e.target.value)}
                    disabled={live}
                    placeholder={t("rule.refund.placeholder")}
                  />
                </RuleRow>

                <div className="pt-4">
                  <VoiceMic
                    label={t("mic.label2")}
                    onTranscript={(text) => void onReviewTranscript(text)}
                    disabled={voiceBusy || live || confirming}
                    className="rounded-2xl border border-rzp-border bg-rzp-mist p-4"
                  />
                  <p className="mt-2 min-h-[1.25rem] text-sm text-rzp-text" aria-live="polite">
                    {voiceBusy ? t("voice.busy") : voiceNote}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---- Sticky action bar ------------------------------------ */}
          <section aria-label={t("golive.aria")} className="sticky bottom-4 z-20">
            <div className="rounded-2xl border border-rzp-border bg-white/90 p-4 shadow-lift backdrop-blur-md sm:px-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  {live ? (
                    <p className="text-sm text-[#087443]">
                      <span className="font-semibold">{t("golive.liveName", { name: shopName })}</span> {t("golive.liveRest")}
                    </p>
                  ) : (
                    <p className="text-sm text-rzp-muted">
                      {t("golive.pendingBefore")} <span className="font-medium text-rzp-text">{shopName}</span> {t("golive.pendingAfter")}
                    </p>
                  )}
                  {confirmError ? (
                    <p className={cn("mt-1 text-sm", ERROR_TEXT)} role="alert">
                      {confirmError}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 md:justify-end">
                  {live ? (
                    <>
                      <Link href="/simulator" className={buttonClasses({ variant: "outline-blue", size: "md" })}>
                        {t("golive.openSimulator")}
                      </Link>
                      <Link href="/dashboard" className={buttonClasses({ variant: "secondary", size: "md" })}>
                        {t("golive.openTower")}
                      </Link>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="lg"
                    variant={live ? "money" : "primary"}
                    onClick={() => void approve()}
                    loading={confirming}
                    disabled={live || confirming}
                    className={cn(live && "disabled:opacity-100")}
                  >
                    {live ? t("golive.liveButton") : t("golive.approve")}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Pieces                                                             */
/* ------------------------------------------------------------------ */

const STEPS: ReadonlyArray<{ key: Step; n: number; labelKey: OnboardKey }> = [
  { key: "catalog", n: 1, labelKey: "step.catalog" },
  { key: "review", n: 2, labelKey: "step.rulebook" },
];

function Stepper({ step, live }: { step: Step; live: boolean }) {
  const t = useT(onboard);
  return (
    <nav aria-label={t("stepper.aria")} className="flex flex-wrap items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const active = step === s.key;
        const done = s.key === "catalog" ? step === "review" : live;
        return (
          <Fragment key={s.key}>
            {i > 0 ? <span aria-hidden="true" className={cn("h-px w-6 sm:w-10", step === "review" ? "bg-rzp-blue" : "bg-rzp-border")} /> : null}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold tracking-wide",
                active && "border-blue-200 bg-blue-50 text-blue-700",
                !active && done && "border-rzp-green/30 bg-rzp-green/10 text-[#087443]",
                !active && !done && "border-rzp-border bg-white text-rzp-muted",
              )}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" /> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
              {t("step.of", { n: s.n, label: t(s.labelKey) })}
            </span>
          </Fragment>
        );
      })}
    </nav>
  );
}

function DraftingSkeleton() {
  const t = useT(onboard);
  const rows = [0, 1, 2, 3, 4, 5];
  const rules = [0, 1, 2, 3, 4];
  return (
    <div className="fade-up space-y-6" aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-sm text-rzp-muted">
        <Spinner className="h-4 w-4 text-rzp-blue" />
        {t("drafting.status")}
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <Card>
          <CardContent className="pt-5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mt-2 h-3.5 w-64" />
            <div className="mt-5 space-y-3">
              {rows.map((r, i) => (
                <div key={r} className="fade-up flex items-center gap-3" style={{ "--delay": `${i * 60}ms` } as CSSProperties}>
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className={cn("h-8", i % 2 ? "w-1/2" : "w-2/5")} />
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="ml-auto h-8 w-20" />
                  <Skeleton className="h-8 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mt-2 h-3.5 w-56" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
            <div className="mt-5 space-y-5">
              {rules.map((r) => (
                <div key={r}>
                  <div className="flex justify-between">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                  <Skeleton className="mt-2 h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RuleRow({ highlighted, className, children }: { highlighted: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("-mx-2 rounded-xl px-2 transition-[background-color,box-shadow] duration-300", highlighted && "bg-rzp-amber/10 ring-1 ring-rzp-amber/40", className)}>
      {children}
    </div>
  );
}

/* ---- tiny inline icons ----------------------------------------------- */

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 15.5v2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2c.6 6 3.4 8.8 10 10-6.6 1.2-9.4 4-10 10-.6-6-3.4-8.8-10-10 6.6-1.2 9.4-4 10-10Z" />
    </svg>
  );
}
