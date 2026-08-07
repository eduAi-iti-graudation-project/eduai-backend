-- AlterTable
-- Convert the three plain-text report sections to structured JSONB while
-- preserving existing content (each old text becomes the primary text field
-- of the matching structured section).
ALTER TABLE "student_reports"
  ALTER COLUMN "parentSection" TYPE JSONB USING jsonb_build_object('message', "parentSection", 'homeSupport', '[]'::jsonb),
  ALTER COLUMN "teacherSection" TYPE JSONB USING jsonb_build_object('analysis', "teacherSection", 'skillGaps', '[]'::jsonb, 'interventions', '[]'::jsonb, 'resourceSuggestions', '[]'::jsonb),
  ALTER COLUMN "managementSection" TYPE JSONB USING jsonb_build_object('summary', "managementSection", 'classTrend', '', 'recommendation', '');
