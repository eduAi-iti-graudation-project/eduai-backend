// Shared markdown guidance appended to prompts whose output is rendered with
// the frontend <RichText> component. RichText renders:
//   **bold**  -> semi-bold with a subtle primary background highlight
//   ==text==  -> strong yellow marker highlight
//   NN%       -> auto-detected percentage chip
export const FORMATTING_RULES = `
OUTPUT MARKUP (follow exactly):
- Wrap every important number or short key phrase in **double asterisks**, e.g. **58%**, **3 consecutive drops**, **below class average**. These render highlighted in the UI.
- Wrap the single most critical finding of the whole message in ==double equals==, e.g. ==Omar is at risk of failing==. Use at most one or two of these.
- Never wrap entire sentences in asterisks; only the important fragments.
- Keep percentages as plain tokens like 58% (never spell out "fifty-eight percent").`;
