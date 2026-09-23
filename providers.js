// Reads an invoice/receipt with whichever AI provider is configured.
// Gemini (Google AI Studio) has a genuinely free tier — no card needed — so it's
// tried first. Anthropic is used if a Gemini key isn't set but an Anthropic key is.
const SYSTEM =
  "You extract data from invoices and receipts. Numbers must be plain numbers with no currency symbols or thousands separators. " +
  "Use null or an empty string when a value is missing; never guess. " +
  "If a date could be read two ways (like 03/09/2026), choose the most likely reading and add a short note. " +
  "If the line items do not add up to the subtotal, or subtotal plus tax does not equal the total, add a short note. " +
  "If the document is not an invoice, return empty fields and a note saying so.";

const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

function fileKind(file) {
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  if (file.mimetype === "application/pdf" || ext === "pdf") return "pdf";
  const imgType = IMAGE_TYPES[ext] || (Object.values(IMAGE_TYPES).includes(file.mimetype) ? file.mimetype : null);
  if (imgType) return imgType;
  if (["txt", "csv", "tsv", "text"].includes(ext) || file.mimetype.startsWith("text/")) return "text";
  return null;
}

/* ---------------- Gemini (free tier) ---------------- */
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    invoice_no: { type: "STRING" }, supplier: { type: "STRING" }, bill_to: { type: "STRING" },
    invoice_date: { type: "STRING" }, due_date: { type: "STRING" }, currency: { type: "STRING" },
    subtotal: { type: "NUMBER", nullable: true }, tax: { type: "NUMBER", nullable: true }, total: { type: "NUMBER", nullable: true },
    payment_terms: { type: "STRING" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          quantity: { type: "NUMBER", nullable: true },
          unit_price: { type: "NUMBER", nullable: true },
          line_total: { type: "NUMBER", nullable: true },
        },
        required: ["description", "quantity", "unit_price", "line_total"],
      },
    },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["invoice_no", "supplier", "bill_to", "invoice_date", "due_date", "currency", "subtotal", "tax", "total", "payment_terms", "lines", "notes"],
};

async function extractGemini(file, apiKey, model) {
  const kind = fileKind(file);
  if (!kind) return { unsupported: true };
  const parts = [{ text: SYSTEM + "\n\nExtract the invoice data from this document." }];
  if (kind === "text") {
    parts.push({ text: "Invoice text:\n\n" + file.buffer.toString("utf8").slice(0, 60000) });
  } else {
    const mime = kind === "pdf" ? "application/pdf" : kind;
    parts.push({ inline_data: { mime_type: mime, data: file.buffer.toString("base64") } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_SCHEMA, temperature: 0 },
  });

  // The free tier can be briefly overloaded (503) or rate-limited (429). Both
  // are usually gone within a few seconds, so retry a couple of times before
  // giving up and showing the person an error.
  const delays = [1000, 3000]; // wait 1s, then 3s
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let resp, data;
    try {
      resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      data = await resp.json().catch(() => ({}));
    } catch (networkErr) {
      lastErr = networkErr; lastErr.status = 0;
      if (attempt < delays.length) { await new Promise((r) => setTimeout(r, delays[attempt])); continue; }
      throw lastErr;
    }
    if (resp.ok) {
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) { const err = new Error("The reader returned no data. Try a clearer file."); err.status = 502; throw err; }
      try { return JSON.parse(text); } catch (e) { const err = new Error("Couldn't understand the reader's response. Try again."); err.status = 502; throw err; }
    }
    const msg = (data && data.error && data.error.message) || "Gemini request failed.";
    const err = new Error(msg);
    err.status = resp.status;
    lastErr = err;
    if ((resp.status === 503 || resp.status === 429) && attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    throw err;
  }
  throw lastErr;
}

/* ---------------- Anthropic (paid) ---------------- */
const num = { type: ["number", "null"] };
const ANTHROPIC_TOOL = {
  name: "record_invoice",
  description: "Record the data extracted from one invoice or receipt.",
  input_schema: {
    type: "object",
    properties: {
      invoice_no: { type: "string" }, supplier: { type: "string" }, bill_to: { type: "string" },
      invoice_date: { type: "string" }, due_date: { type: "string" }, currency: { type: "string" },
      subtotal: num, tax: num, total: num, payment_terms: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: { description: { type: "string" }, quantity: num, unit_price: num, line_total: num },
          required: ["description", "quantity", "unit_price", "line_total"],
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["invoice_no", "supplier", "bill_to", "invoice_date", "due_date", "currency", "subtotal", "tax", "total", "payment_terms", "lines", "notes"],
  },
};

async function extractAnthropic(file, client, model) {
  const kind = fileKind(file);
  if (!kind) return { unsupported: true };
  const ask = { type: "text", text: "Extract the invoice data from this document." };
  let content;
  if (kind === "pdf") content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") } }, ask];
  else if (kind === "text") content = [{ type: "text", text: "Invoice text:\n\n" + file.buffer.toString("utf8").slice(0, 60000) }, ask];
  else content = [{ type: "image", source: { type: "base64", media_type: kind, data: file.buffer.toString("base64") } }, ask];

  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM + " Always call the record_invoice tool.",
    tools: [ANTHROPIC_TOOL],
    tool_choice: { type: "tool", name: "record_invoice" },
    messages: [{ role: "user", content }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block) { const err = new Error("The reader returned no data. Try a clearer file."); err.status = 502; throw err; }
  return block.input;
}

module.exports = { extractGemini, extractAnthropic, fileKind, SYSTEM };
