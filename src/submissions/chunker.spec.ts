import { chunkText } from './chunker';

describe('chunkText', () => {
  it('returns empty array for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns empty array for whitespace-only text', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    const text = 'This is a short submission.';
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits text into multiple chunks at paragraph boundaries', () => {
    const paras = Array.from({ length: 10 }, (_, i) =>
      `Paragraph number ${i + 1}. `.repeat(30),
    );
    const text = paras.join('\n\n');
    const result = chunkText(text);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2200);
    }
  });

  it('does not interleave different paragraph content outside of overlap', () => {
    const paras = Array.from({ length: 4 }, (_, i) =>
      `===PARA${i + 1}=== `.repeat(80),
    );
    const text = paras.join('\n\n');
    const result = chunkText(text);

    for (const chunk of result) {
      const seen = new Set<string>();
      const parts = chunk.split('\n\n');
      for (const part of parts) {
        const match = part.match(/===PARA(\d+)===/);
        if (match) seen.add(match[1]);
      }
      expect(seen.size).toBeLessThanOrEqual(2);
    }
  });

  it('includes overlap between consecutive chunks', () => {
    const paras = Array.from({ length: 8 }, (_, i) =>
      `Overlap test paragraph number ${i + 1}. `.repeat(20),
    );
    const text = paras.join('\n\n');
    const result = chunkText(text);

    if (result.length >= 2) {
      const firstEnd = result[0].slice(-300);
      const secondStart = result[1].slice(0, 300);
      const overlap = firstEnd.split('\n\n').filter(Boolean).pop() || '';
      expect(secondStart).toContain(overlap.slice(0, 50));
    }
  });

  it('handles a single paragraph longer than MAX_CHARS', () => {
    const longPara = 'Sentence. '.repeat(500);
    const result = chunkText(longPara);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].length).toBeLessThanOrEqual(3000);
  });
});
