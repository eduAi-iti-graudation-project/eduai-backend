// Shared markdown style guide appended to prompts whose output is rendered
// with the frontend <RichText> component. RichText renders standard markdown
// plus a few custom tokens:
//   **bold**   -> semi-bold with a subtle primary background highlight
//   ==text==   -> strong yellow marker highlight
//   NN%        -> auto-detected percentage chip
//   ### Title  -> styled section heading
//   - item     -> bulleted list with primary-colored markers
export const FORMATTING_RULES = `
OUTPUT MARKUP (follow exactly):
- Long-form text must NEVER be a single dense paragraph. Break it into labeled sections using markdown headings (###), e.g. "### Key numbers", "### What's working", "### Main concerns", "### Recommended next steps", "### To improve".
- Use bullet lists (-) under each heading. Keep every bullet short (a few words to one short sentence, at most ~15 words).
- Always OPEN the message with one bolded one-line takeaway: a single sentence that states the headline finding, e.g. **Overall score 39.5% — 19.5 pts below the class average**.
- Wrap every important number or short key phrase in **double asterisks**, e.g. **58%**, **3 consecutive drops**, **below class average**. These render highlighted in the UI.
- Wrap the single most critical finding of the whole message in ==double equals==, e.g. ==This student is at risk of falling behind==. Use at most one or two of these.
- Never wrap entire sentences in asterisks; only the important fragments.
- Keep percentages as plain tokens like 58% (never spell out "fifty-eight percent") so they render as chips.
- Never output raw HTML, code fences, or JSON in prose fields — markdown only.`;
