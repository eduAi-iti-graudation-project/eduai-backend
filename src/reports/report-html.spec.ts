import {
  buildReportHtml,
  escapeHtml,
  initials,
  renderInline,
  renderParagraphs,
  type ReportHtmlInput,
} from './report-html';

const baseInput: ReportHtmlInput = {
  orgName: 'Green Hills Academy',
  orgInitials: 'GHA',
  logoDataUri: null,
  studentName: 'Omar Hassan',
  alertType: 'FAILING',
  alertReason: 'Average score dropped to **45%**',
  generatedAt: new Date('2026-08-18'),
  parentSection: {
    message: 'Omar has been ==struggling with math== recently.',
    homeSupport: ['Set a nightly study routine', 'Review class notes weekly'],
  },
  teacherSection: {
    analysis: 'Scores have fallen over the last three weeks.',
    skillGaps: ['Fractions', 'Word problems'],
    interventions: ['Small group tutoring'],
    resourceSuggestions: ['Khan Academy exercises'],
  },
  managementSection: {
    summary: 'Overall status is concerning.',
    classTrend: 'Below class average.',
    recommendation: 'Schedule a parent conference.',
  },
};

describe('escapeHtml', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml('<script>alert("x")</script> &')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;',
    );
  });
});

describe('renderInline', () => {
  it('converts bold and highlight markup', () => {
    const out = renderInline('Score is **45%** and ==at risk==');
    expect(out).toContain('<strong class="em">45%</strong>');
    expect(out).toContain('<mark>at risk</mark>');
  });

  it('escapes raw HTML before applying markup', () => {
    const out = renderInline('<img src=x onerror=alert(1)> **bold**');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
  });

  it('turns bare URLs into safe links', () => {
    const out = renderInline('See https://owl.purdue.edu for details.');
    expect(out).toContain(
      '<a href="https://owl.purdue.edu" target="_blank" rel="noopener noreferrer">https://owl.purdue.edu</a>',
    );
  });

  it('linkifies www URLs with an added scheme', () => {
    const out = renderInline('Check www.khanacademy.org now');
    expect(out).toContain(
      '<a href="https://www.khanacademy.org" target="_blank" rel="noopener noreferrer">www.khanacademy.org</a>',
    );
  });
});

describe('renderParagraphs', () => {
  it('splits on blank lines into paragraphs', () => {
    const out = renderParagraphs('First paragraph.\n\nSecond paragraph.');
    expect(out).toContain('<p>First paragraph.</p>');
    expect(out).toContain('<p>Second paragraph.</p>');
  });

  it('turns single newlines into line breaks', () => {
    const out = renderParagraphs('Line one\nLine two');
    expect(out).toContain('Line one<br />Line two');
  });
});

describe('initials', () => {
  it('derives up to two initials', () => {
    expect(initials('Green Hills Academy')).toBe('GH');
    expect(initials('Nile International School')).toBe('NI');
  });

  it('falls back to SC for blank names', () => {
    expect(initials('   ')).toBe('SC');
  });
});

describe('buildReportHtml', () => {
  it('embeds a data-URI logo when present', () => {
    const html = buildReportHtml({
      ...baseInput,
      logoDataUri: 'data:image/png;base64,AAAA',
    });
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('<img class="logo"');
  });

  it('falls back to a monogram tile when no logo is set', () => {
    const html = buildReportHtml(baseInput);
    expect(html).toContain('logo-fallback');
    expect(html).toContain('GHA');
  });

  it('renders org and student names', () => {
    const html = buildReportHtml(baseInput);
    expect(html).toContain('Green Hills Academy');
    expect(html).toContain('Omar Hassan');
  });

  it('renders all three audience sections', () => {
    const html = buildReportHtml(baseInput);
    expect(html).toContain('A note for parents');
    expect(html).toContain('Pedagogical analysis');
    expect(html).toContain('Management summary');
    expect(html).toContain('Ways to support at home');
    expect(html).toContain('Skills falling behind');
    expect(html).toContain('Recommended next step');
  });

  it('applies markup conversion inside the document', () => {
    const html = buildReportHtml(baseInput);
    expect(html).toContain('<strong class="em">45%</strong>');
    expect(html).toContain('<mark>struggling with math</mark>');
  });

  it('never leaks raw HTML from LLM fields', () => {
    const html = buildReportHtml({
      ...baseInput,
      parentSection: {
        message: '<script>alert(1)</script> **bold**',
        homeSupport: ['<b>x</b>'],
      },
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('<strong class="em">bold</strong>');
  });

  it('produces a full HTML5 document', () => {
    const html = buildReportHtml(baseInput);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });
});
