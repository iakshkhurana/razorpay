import { z } from "zod";
import { error, json } from "@/lib/api";
import { getOpenAI, llmMode, MODELS } from "@/lib/llm/router";
import { beginTurn, endTurn } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * A photo of a price list or a handwritten bill → structured catalog rows.
 * gpt-4o reads the image and must return strict JSON; zod validates every
 * row before it becomes CSV for the onboarding textarea. Without a key the
 * client keeps the manual CSV path — 501 says so plainly.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const RowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price_inr: z.number().nonnegative().max(10_000_000),
  stock: z.number().int().nonnegative().max(1_000_000).optional(),
  category: z.string().trim().max(40).optional(),
  description: z.string().trim().max(300).optional(),
});
const RowsSchema = z.object({ rows: z.array(RowSchema).min(1).max(100) });

const PROMPT = `You read photos of Indian shop price lists, bills and handwritten stock registers.
Extract the products as JSON: {"rows":[{"name":string,"price_inr":number,"stock":number?,"category":string?,"description":string?}]}.
Rules: prices in rupees as numbers (strip ₹, Rs, commas); skip totals, taxes and phone numbers; guess a short lowercase category (handloom, gifts, grocery, footwear, general) only when obvious; leave stock out when not written. Return ONLY the JSON object.`;

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function POST(req: Request) {
  if (llmMode() !== "openai") {
    return json({ ok: false, fallback: "manual", error: "Photo reading needs the OpenAI key. Paste the CSV instead." }, 501);
  }

  let image: Blob | null = null;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (file instanceof Blob) image = file;
    } else if (contentType.startsWith("image/")) {
      image = new Blob([await req.arrayBuffer()], { type: contentType });
    }
  } catch {
    image = null;
  }
  if (!image || image.size === 0) return error("Send the photo as multipart `file` or a raw image body.", 400);
  if (!IMAGE_TYPES.has(image.type)) return error("Use a JPEG, PNG or WebP photo.", 415);
  if (image.size > MAX_IMAGE_BYTES) return error("The photo is over 5 MB. A phone screenshot works fine.", 413);

  const dataUrl = `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;

  beginTurn("vision");
  try {
    const res = await getOpenAI().chat.completions.create(
      {
        model: MODELS.heavy,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl, detail: "high" } }] },
        ],
      },
      { timeout: 45_000 },
    );
    endTurn({ mode: "openai" });

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.choices[0]?.message?.content ?? "");
    } catch {
      return error("Could not read products from that photo. Try a straighter shot, or paste the CSV.", 422);
    }
    const rows = RowsSchema.safeParse(parsed);
    if (!rows.success) return error("Could not read products from that photo. Try a straighter shot, or paste the CSV.", 422);

    const lines = ["name,description,price_inr,stock,category,tags"];
    for (const r of rows.data.rows) {
      lines.push([r.name, r.description ?? "", String(r.price_inr), r.stock !== undefined ? String(r.stock) : "", r.category ?? "", ""].map(csvField).join(","));
    }
    return json({ ok: true, count: rows.data.rows.length, csv: lines.join("\n"), rows: rows.data.rows });
  } catch (err) {
    endTurn({ ok: false });
    console.warn(`[vision] failed: ${err instanceof Error ? err.message : "error"}`);
    return error("The photo reader did not respond. Try again, or paste the CSV.", 502);
  }
}
