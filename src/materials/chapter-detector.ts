export interface DetectedChapter {
  title: string;
  startLine: number;
}

const HEADING_RE =
  /^\s*(chapter|unit|lesson|module|part|section|topic)\s+(\d{1,4}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;

const TOC_LEADER_RE = /(?:\.{2,}|…)\s*\d{1,4}\s*$/;

const MAX_HEADING_LENGTH = 90;
const MIN_BODY_CHARS_BETWEEN_HEADINGS = 120;
const REPEAT_WINDOW = 50;

export function detectChapters(rawText: string): DetectedChapter[] {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const chapters: DetectedChapter[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > MAX_HEADING_LENGTH) continue;
    if (!HEADING_RE.test(line)) continue;
    if (TOC_LEADER_RE.test(line)) continue;

    const title = line
      .replace(/[.:\-_=*#]{2,}$/, '')
      .trim()
      .replace(/\s{2,}/g, ' ');

    if (title.length === 0) continue;

    const last = chapters[chapters.length - 1];
    if (last && isLikelyTocEntry(lines, last.startLine, i)) continue;
    if (last && isRepeat(title, chapters)) continue;

    chapters.push({ title, startLine: i });
  }

  return chapters;
}

/**
 * A heading is considered a Table-of-Contents entry (and is skipped) when:
 * - it sits in a dense cluster of heading-like lines, and
 * - there is almost no body text between it and the previous heading.
 */
function isLikelyTocEntry(
  lines: string[],
  previousHeadingLine: number,
  currentLine: number,
): boolean {
  const gapLines = lines.slice(previousHeadingLine + 1, currentLine);
  const gapChars = gapLines.reduce((sum, l) => sum + l.length, 0);

  const window = lines.slice(
    previousHeadingLine,
    Math.min(lines.length, currentLine + 12),
  );
  const denseCluster =
    window.filter((l) => HEADING_RE.test(l.trim())).length >= 4;

  return denseCluster && gapChars < MIN_BODY_CHARS_BETWEEN_HEADINGS;
}

function isRepeat(title: string, chapters: DetectedChapter[]): boolean {
  const recent = chapters.slice(-REPEAT_WINDOW);
  return recent.some((c) => c.title === title);
}
