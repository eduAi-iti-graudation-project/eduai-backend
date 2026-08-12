import {
  gmailLocal,
  gmailCandidate,
  uniqueEmail,
  generatePassword,
} from './generated-credentials';

describe('generated-credentials', () => {
  describe('gmailLocal', () => {
    it('builds firstname.lastname from parts', () => {
      expect(gmailLocal('Jane', 'Doe')).toBe('jane.doe');
    });

    it('falls back to the first name when last name is missing', () => {
      expect(gmailLocal('Jane')).toBe('jane');
    });

    it('normalizes accents, punctuation and casing', () => {
      expect(gmailLocal('Jáne', 'Döe')).toBe('jane.doe');
      expect(gmailLocal('  Omar-El', 'Ali')).toBe('omar.el.ali');
    });

    it('collapses repeated separators and trims edges', () => {
      expect(gmailLocal('Aya', 'Hassan!')).toBe('aya.hassan');
    });

    it('never returns an empty local part', () => {
      expect(gmailLocal('!!!')).toBe('student');
    });
  });

  describe('gmailCandidate / uniqueEmail', () => {
    it('suffixes only when the base is taken', () => {
      const taken = new Set(['jane.doe']);
      const base = gmailLocal('Jane', 'Doe');
      expect(gmailCandidate(base)).toBe('jane.doe@gmail.com');
      expect(gmailCandidate(base, 2)).toBe('jane.doe.2@gmail.com');
      expect(uniqueEmail(taken, base)).toBe('jane.doe.2');
    });

    it('returns base when free', () => {
      expect(uniqueEmail(new Set(), 'jane.doe')).toBe('jane.doe');
    });

    it('returns null when all suffixes are exhausted', () => {
      const taken = new Set(
        Array.from({ length: 101 }, (_, i) =>
          i === 0 ? 'jane.doe' : `jane.doe.${i}`,
        ),
      );
      expect(uniqueEmail(taken, 'jane.doe')).toBeNull();
    });
  });

  describe('generatePassword', () => {
    it('produces a password of the requested length', () => {
      expect(generatePassword(10)).toHaveLength(10);
      expect(generatePassword(16)).toHaveLength(16);
    });

    it('only uses characters from the unambiguous alphabet', () => {
      const password = generatePassword(64);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    });
  });
});
