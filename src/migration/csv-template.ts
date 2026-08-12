/**
 * Blank import template, matching the headers the import wizard treats as
 * deterministic (no AI mapping step). Mirrors the frontend csv-parser
 * TEMPLATE_HEADERS/TEMPLATE_EXAMPLE verbatim.
 */
export const TEMPLATE_CSV = [
  'firstName,lastName,email,gradeLevelName,sectionName,dateOfBirth,guardianName,guardianEmail',
  'Jane,Doe,jane.doe@example.com,Grade 7,A,2014-03-12,Joan Doe,joan.doe@example.com',
].join('\n');
