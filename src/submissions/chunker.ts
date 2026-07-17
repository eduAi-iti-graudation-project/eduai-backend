const MAX_CHARS = 2000;
const MIN_CHARS = 1200;
const OVERLAP_CHARS = 200;

export function chunkText(text: string): string[] {
  if (!text.trim()) return [];

  const paragraphs = splitParagraphs(text);
  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;

  function flush() {
    if (buffer.length === 0) return '';
    const chunk = buffer.join('\n\n');
    chunks.push(chunk);
    buffer = buildOverlap(buffer);
    bufferLen = buffer.reduce((sum, p) => sum + p.length, 0);
    return chunk;
  }

  function outputLen(nextItem: string): number {
    const sepOverhead = buffer.length > 0 ? 2 : 0;
    return bufferLen + sepOverhead + nextItem.length;
  }

  for (const para of paragraphs) {
    if (para.length > MAX_CHARS) {
      flush();
      for (const sentence of splitSentences(para)) {
        if (outputLen(sentence) > MAX_CHARS && bufferLen >= MIN_CHARS) {
          flush();
        }
        buffer.push(sentence);
        bufferLen += sentence.length;
      }
    } else {
      if (outputLen(para) > MAX_CHARS && bufferLen >= MIN_CHARS) {
        flush();
      }
      buffer.push(para);
      bufferLen += para.length;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join('\n\n'));
  }

  return chunks;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts || parts.length === 0) return [text];
  const remainder = text.slice(parts.join('').length).trim();
  return remainder ? [...parts, remainder] : parts;
}

function buildOverlap(buffer: string[]): string[] {
  const overlap: string[] = [];
  let overlapLen = 0;
  for (let i = buffer.length - 1; i >= 0 && overlapLen < OVERLAP_CHARS; i--) {
    overlap.unshift(buffer[i]);
    overlapLen += buffer[i].length;
  }
  return overlap;
}
