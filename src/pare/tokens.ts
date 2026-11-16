// Rough token estimates for sending a document to Claude, as a PDF or as text.
//
// Per Anthropic's docs (platform.claude.com/docs/en/build-with-claude/pdf-support
// and /vision): a PDF is sent as each page's extracted text *plus* an image of
// each page. Images cost ⌈width/28⌉ × ⌈height/28⌉ tokens, after being scaled
// down to fit the model's limits. The docs don't say what size a PDF page is
// drawn at, so this assumes the largest the model accepts: an upper estimate.
//
// Text is estimated at about 4 characters a token; Claude 4.7 and later use a
// tokenizer that gives about 30% more tokens for the same text.

export type Tier = 'high' | 'standard';

export const TIERS: Record<Tier, { label: string; longEdge: number; maxTokens: number; textFactor: number }> = {
  high: { label: 'Claude 4.7 and later', longEdge: 2576, maxTokens: 4784, textFactor: 1.3 },
  standard: { label: 'Earlier Claude models', longEdge: 1568, maxTokens: 1568, textFactor: 1 },
};

export function textTokens(text: string, tier: Tier): number {
  const chars = text.replace(/[ \t]+/g, ' ').length;
  return Math.ceil((chars / 4) * TIERS[tier].textFactor);
}

/** Tokens for one page image, with the page drawn as large as the model allows. */
export function pageImageTokens(page: { w: number; h: number }, tier: Tier): number {
  const t = TIERS[tier];
  const aspect = page.w / page.h || 0.773;
  // Largest size that fits both the long-edge and the token limit.
  let h = aspect <= 1 ? t.longEdge : t.longEdge / aspect;
  let w = h * aspect;
  const tokensAt = (w: number, h: number) => Math.ceil(w / 28) * Math.ceil(h / 28);
  while (tokensAt(w, h) > t.maxTokens) {
    h *= 0.99;
    w = h * aspect;
  }
  return tokensAt(w, h);
}

export interface Estimate {
  pdfText: number;
  pdfImages: number;
  pdf: number;
  text: number;
  saved: number; // 0..1
}

export function estimate(rawText: string, pages: Array<{ w: number; h: number }>, output: string, tier: Tier): Estimate {
  const pdfText = textTokens(rawText, tier);
  const pdfImages = pages.reduce((n, p) => n + pageImageTokens(p, tier), 0);
  const pdf = pdfText + pdfImages;
  const text = textTokens(output, tier);
  return { pdfText, pdfImages, pdf, text, saved: pdf ? Math.max(0, 1 - text / pdf) : 0 };
}
