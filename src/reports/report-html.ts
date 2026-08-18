export interface ParentSectionHtml {
  message: string;
  homeSupport: string[];
}

export interface TeacherSectionHtml {
  analysis: string;
  skillGaps: string[];
  interventions: string[];
  resourceSuggestions: string[];
}

export interface ManagementSectionHtml {
  summary: string;
  classTrend: string;
  recommendation: string;
}

export interface ReportHtmlInput {
  orgName: string;
  orgInitials: string;
  /** Base64 data URI of the school logo, or null when no logo is set. */
  logoDataUri: string | null;
  studentName: string;
  alertType: string;
  alertReason: string;
  generatedAt: Date;
  parentSection: ParentSectionHtml;
  teacherSection: TeacherSectionHtml;
  managementSection: ManagementSectionHtml;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert the LLM's light markup into safe inline HTML:
 *   **text** -> <strong class="em">, ==text== -> <mark>
 * Bare URLs are turned into safe links.
 * Input is HTML-escaped first so the LLM can never inject markup.
 */
export function renderInline(text: string): string {
  const safe = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="em">$1</strong>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>');
  return linkifyUrls(safe);
}

/** Wrap bare http(s)/www URLs in safe anchors (runs on HTML-escaped text). */
function linkifyUrls(escapedText: string): string {
  return escapedText.replace(
    /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/g,
    (match) => {
      const href = match.startsWith('http') ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    },
  );
}

/** Render a free-text field as paragraph(s), splitting on blank lines. */
export function renderParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${renderInline(paragraph).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

function renderList(items: string[], bullet: string): string {
  if (!items.length) return '';
  return `<ul>${items
    .map(
      (item) =>
        `<li><span class="bullet">${bullet}</span>${renderInline(item)}</li>`,
    )
    .join('')}</ul>`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!words.length) return 'SC';
  return words
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function alertBadge(type: string): string {
  return `<span class="badge">${escapeHtml(type)}</span>`;
}

function sectionCard(
  accent: 'parent' | 'teacher' | 'management',
  title: string,
  audience: string,
  icon: string,
  body: string,
): string {
  return `
    <section class="card ${accent}">
      <div class="card-head">
        <span class="icon">${icon}</span>
        <div>
          <h2>${title}</h2>
          <span class="audience">${audience}</span>
        </div>
      </div>
      <div class="card-body">${body}</div>
    </section>`;
}

export function buildReportHtml(input: ReportHtmlInput): string {
  const logoBlock = input.logoDataUri
    ? `<img class="logo" src="${input.logoDataUri}" alt="${escapeHtml(input.orgName)} logo" />`
    : `<div class="logo-fallback" aria-hidden="true">${escapeHtml(input.orgInitials)}</div>`;

  const metaRows = [
    ['Student', escapeHtml(input.studentName)],
    ['Alert', alertBadge(input.alertType)],
    ['Generated', escapeHtml(formatDate(input.generatedAt))],
  ];

  const parentBody = `
    ${renderParagraphs(input.parentSection.message)}
    <h3>Ways to support at home</h3>
    ${renderList(input.parentSection.homeSupport, '&#10003;')}`;

  const teacherBody = `
    <h3>Analysis</h3>
    ${renderParagraphs(input.teacherSection.analysis)}
    <h3>Skills falling behind</h3>
    ${renderList(input.teacherSection.skillGaps, '&#9679;')}
    <h3>Classroom interventions</h3>
    ${renderList(input.teacherSection.interventions, '&#9679;')}
    <h3>Resources &amp; tools</h3>
    ${renderList(input.teacherSection.resourceSuggestions, '&#9679;')}`;

  const managementBody = `
    <h3>Summary</h3>
    ${renderParagraphs(input.managementSection.summary)}
    <h3>Class comparison</h3>
    ${renderParagraphs(input.managementSection.classTrend)}
    <h3>Recommended next step</h3>
    ${renderParagraphs(input.managementSection.recommendation)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(input.orgName)} — Student Progress Report</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1f2937;
    line-height: 1.6;
  }
  .sheet {
    max-width: none;
    width: 100%;
    margin: 0;
    background: #ffffff;
    border-radius: 0;
    overflow: hidden;
    box-shadow: none;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 28px 36px;
    background: linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%);
    color: #ffffff;
  }
  .header .logo {
    width: 56px;
    height: 56px;
    object-fit: contain;
    border-radius: 12px;
    background: #ffffff;
    padding: 4px;
  }
  .header .logo-fallback {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .header .title-block h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }
  .header .title-block p {
    margin: 4px 0 0;
    font-size: 13px;
    opacity: 0.85;
  }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 32px;
    padding: 24px 36px;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .meta .row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 6px 0;
  }
  .meta .row span:first-child {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
    min-width: 84px;
  }
  .meta .row .value { font-weight: 600; font-size: 15px; }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    background: #fee2e2;
    color: #991b1b;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .content { padding: 8px 36px 28px; }
  .card {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    margin-top: 22px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(31, 41, 55, 0.05);
  }
  .card .card-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .card .icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    color: #ffffff;
  }
  .card h2 { margin: 0; font-size: 16px; }
  .card .audience { font-size: 12px; color: #6b7280; }
  .card .card-body { padding: 18px; }
  .card .card-body h3 {
    margin: 18px 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #4b5563;
  }
  .card .card-body h3:first-child { margin-top: 0; }
  .card p { margin: 0 0 10px; }
  .card p:last-child { margin-bottom: 0; }
  .card ul { list-style: none; margin: 0; padding: 0; }
  .card li {
    position: relative;
    padding: 6px 0 6px 26px;
  }
  .card li .bullet {
    position: absolute;
    left: 0;
    top: 6px;
    width: 18px;
    text-align: center;
    font-weight: 700;
  }
  strong.em {
    font-weight: 700;
    color: inherit;
    background: #eef2ff;
    border-radius: 4px;
    padding: 0 4px;
  }
  .card a {
    color: #4338ca;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-word;
  }
  mark {
    background: #fef08a;
    color: inherit;
    border-radius: 4px;
    padding: 0 3px;
  }
  .card.parent .icon { background: #059669; }
  .card.parent { border-top: 4px solid #059669; }
  .card.teacher .icon { background: #4f46e5; }
  .card.teacher { border-top: 4px solid #4f46e5; }
  .card.management .icon { background: #d97706; }
  .card.management { border-top: 4px solid #d97706; }
  .footer {
    padding: 16px 36px 28px;
    color: #9ca3af;
    font-size: 12px;
    border-top: 1px solid #eef2f7;
  }
  @media print {
    body { background: #ffffff; }
    .sheet { margin: 0; border-radius: 0; box-shadow: none; max-width: none; }
    .card { break-inside: avoid; }
  }
  @media (max-width: 640px) {
    .meta { grid-template-columns: 1fr; }
    .header, .meta, .content, .footer { padding-left: 20px; padding-right: 20px; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      ${logoBlock}
      <div class="title-block">
        <h1>Student Progress Report</h1>
        <p>${escapeHtml(input.orgName)}</p>
      </div>
    </div>
    <div class="meta">
      ${metaRows
        .map(
          (row) =>
            `<div class="row"><span>${row[0]}</span><span class="value">${row[1]}</span></div>`,
        )
        .join('')}
      <div class="row"><span>Reason</span><span class="value">${renderInline(input.alertReason)}</span></div>
    </div>
    <div class="content">
      ${sectionCard('parent', 'A note for parents', 'Plain-language update for the family', '&#128172;', parentBody)}
      ${sectionCard('teacher', 'Pedagogical analysis', 'For the teaching team', '&#127891;', teacherBody)}
      ${sectionCard('management', 'Management summary', 'For school leadership', '&#128200;', managementBody)}
    </div>
    <div class="footer">
      Generated automatically by EduAI for ${escapeHtml(input.orgName)} on ${escapeHtml(formatDate(input.generatedAt))}.
      This report is confidential and intended only for the school and the student's family.
    </div>
  </div>
</body>
</html>`;
}
