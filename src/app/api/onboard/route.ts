import { error, json, parseBody } from "@/lib/api";
import { extractCatalog, utteranceToPolicyPatch } from "@/lib/llm/onboarding";
import { llmMode } from "@/lib/llm/router";
import { OnboardRequestSchema, PolicySchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Messy input → draft catalog + draft policy. Nothing goes live until /api/policy/confirm. */
export async function POST(req: Request) {
  const body = await parseBody(req, OnboardRequestSchema);
  if (!body.ok) return body.response;

  const extracted = await extractCatalog({ url: body.data.url, csv: body.data.csv, merchant_name: body.data.merchant_name });
  if (extracted.skus.length === 0) {
    return error("No products found in that input. Paste a CSV with name and price columns.", 422);
  }

  let policy = extracted.policy;
  let voice: { patch: Record<string, unknown>; spoken_confirmation: string; source: string } | null = null;
  if (body.data.voice_utterance?.trim()) {
    const result = await utteranceToPolicyPatch(body.data.voice_utterance);
    const merged = PolicySchema.safeParse({ ...policy, ...result.patch });
    if (merged.success) policy = merged.data;
    voice = { patch: result.patch, spoken_confirmation: result.spoken_confirmation, source: result.source };
  }

  return json({
    ok: true,
    merchant_name: extracted.merchant_name,
    skus: extracted.skus,
    policy,
    source: extracted.source,
    llm_mode: llmMode(),
    voice,
  });
}
