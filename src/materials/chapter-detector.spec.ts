import { detectChapters } from './chapter-detector';

describe('chapter-detector', () => {
  it('detects chapter headings and skips the table of contents', () => {
    const raw = [
      'Biology for Beginners',
      '',
      'Table of Contents',
      'Chapter 1 Introduction ..... 3',
      'Chapter 2 Cells .......... 21',
      'Chapter 3 Genetics ....... 45',
      '',
      'Chapter 1 Introduction',
      'Biology is the science of life.',
      'It studies living organisms from bacteria to whales.',
      'Organisms grow, reproduce, and respond to their environment.',
      'All living things are made of cells, the smallest units of life.',
      'The study of biology is divided into many branches of knowledge.',
      '',
      'Chapter 2 Cells',
      'The cell is the basic structural unit of all living organisms.',
      'Cells contain a cell membrane which controls what enters them.',
      'The nucleus stores genetic material inside every living cell.',
      'Mitochondria produce the energy that cells need to survive.',
      'Plant cells also contain chloroplasts used for photosynthesis.',
      'Cell theory was developed by early microscopists who observed life.',
      '',
    ].join('\n');

    const chapters = detectChapters(raw);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: 'Chapter 1 Introduction' });
    expect(chapters[1]).toMatchObject({ title: 'Chapter 2 Cells' });
  });

  it('returns nothing for flat text without heading patterns', () => {
    const raw = [
      'Just some prose.',
      'It contains no chapter markers whatsoever.',
      'Learn the second chapter of the book anyway.',
    ].join('\n');

    expect(detectChapters(raw)).toHaveLength(0);
  });

  it('ignores headings that repeat near each other (running headers)', () => {
    const raw = [
      'Chapter 3 Genetics',
      'DNA is the molecule that carries genetic instructions.',
      'DNA is the molecule that carries genetic instructions.',
      'DNA is the molecule that carries genetic instructions.',
      '',
      'Chapter 3 Genetics',
      'Genes are segments of DNA that code for proteins.',
      'Genes are segments of DNA that code for proteins.',
      'Genes are segments of DNA that code for proteins.',
    ].join('\n');

    const chapters = detectChapters(raw);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('Chapter 3 Genetics');
  });

  it('detects unit and part style headings with roman numerals', () => {
    const raw = [
      'Unit I Algebra',
      'Algebra studies symbols to solve equations and inequalities.',
      'Linear equations are the simplest kind that students master.',
      'Graphing lines requires understanding the slope and intercept.',
      'Solving systems means finding points where lines intersect.',
      '',
      'Unit II Geometry',
      'Geometry studies shapes, sizes, and properties of space.',
      'Triangles are the building blocks of many complex figures.',
      'Circles and their properties appear throughout the subject.',
      'Proofs show why a geometric statement is always true.',
    ].join('\n');

    const chapters = detectChapters(raw);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Unit I Algebra');
    expect(chapters[1].title).toBe('Unit II Geometry');
  });
});
