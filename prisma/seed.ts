import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { chunkText } from '../src/common/chunker';
import { createClient } from '@supabase/supabase-js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SAMPLE_ESSAY = `The Impact of Artificial Intelligence on Modern Education

Artificial intelligence is transforming the way students learn and teachers instruct in classrooms around the world. This essay examines the key benefits and challenges of AI in education, focusing on personalized learning, administrative efficiency, and ethical considerations.

One of the most significant advantages of AI in education is personalized learning. AI-powered systems can adapt to individual student needs, providing customized content and pacing that matches each learner's abilities. For example, intelligent tutoring systems can identify areas where a student struggles and offer additional practice problems or alternative explanations. This level of personalization was previously impossible in traditional classroom settings where one teacher must address the needs of thirty or more students simultaneously.

Furthermore, AI can significantly reduce the administrative burden on teachers. Automated grading systems can handle multiple-choice questions and even provide初步 feedback on written assignments. This frees up educators to focus on what matters most: meaningful interaction with their students. Additionally, AI can help with lesson planning, attendance tracking, and identifying students who may be falling behind.

However, the integration of AI in education is not without challenges. Privacy concerns are paramount, as AI systems require large amounts of student data to function effectively. Schools must ensure that student information is protected and that AI tools comply with relevant regulations. There is also the risk of algorithmic bias, where AI systems may inadvertently disadvantage certain groups of students.

Another concern is the potential for reduced human interaction. Education is not merely about transmitting information; it is also about developing social skills, empathy, and critical thinking through discussion and collaboration. Over-reliance on AI could lead to students missing out on these essential aspects of education.

In conclusion, while AI offers tremendous potential to enhance education through personalization and efficiency, it must be implemented thoughtfully. Schools should adopt AI tools that augment rather than replace human teachers, and they must address privacy and equity concerns proactively. The goal should be to use AI as a tool that empowers both teachers and students, not as a replacement for the human elements that make education meaningful.`;

async function createAuthUser(
  email: string,
  password: string,
  name: string,
): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn(`  ⚠ SUPABASE_URL or SUPABASE_SERVICE_KEY not set, skipping auth for ${email}`);
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (data?.user?.id) return data.user.id;

  // If already exists (409 or specific message), sign in to get their auth ID
  if (error?.status === 409 || error?.message?.includes('already been registered')) {
    const { data: signIn } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signIn?.user?.id) return signIn.user.id;
  }

  console.warn(`  ⚠ Auth user creation skipped for ${email}: ${error?.message ?? 'unknown error'}`);
  return null;
}

async function main() {
  console.log('Seeding database...');

  const organization = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-00000000a001' },
    update: { joinCode: 'DEMO2026' },
    create: {
      id: '00000000-0000-0000-0000-00000000a001',
      name: 'Demo School',
      joinCode: 'DEMO2026',
      seatLimit: 50,
    },
  });
  console.log(`  Organization: ${organization.name} (${organization.id})`);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@eduai.test' },
    update: {},
    create: {
      email: 'admin@eduai.test',
      name: 'Admin User',
      role: 'ADMIN',
      organizationId: organization.id,
    },
  });
  console.log(`  Admin: ${adminUser.name} (${adminUser.id})`);

  for (let level = 1; level <= 12; level++) {
    await prisma.gradeLevel.upsert({
      where: { organizationId_level: { organizationId: organization.id, level } },
      update: { name: `Grade ${level}` },
      create: { organizationId: organization.id, level, name: `Grade ${level}` },
    });
  }
  console.log('  Grades 1–12 created');

  const grade10 = await prisma.gradeLevel.findUniqueOrThrow({
    where: { organizationId_level: { organizationId: organization.id, level: 10 } },
  });

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@eduai.test' },
    update: {},
    create: {
      email: 'teacher@eduai.test',
      name: 'Alex Mentor',
      role: 'TEACHER',
      organizationId: organization.id,
    },
  });
  console.log(`  Teacher: ${teacher.name} (${teacher.id})`);

  const student = await prisma.user.upsert({
    where: { email: 'student@eduai.test' },
    update: {},
    create: {
      email: 'student@eduai.test',
      name: 'Sam Learner',
      role: 'STUDENT',
      gradeId: grade10.id,
      organizationId: organization.id,
    },
  });
  console.log(`  Student: ${student.name} (${student.id})`);

  const guardian = await prisma.user.upsert({
    where: { email: 'guardian@eduai.test' },
    update: {},
    create: {
      email: 'guardian@eduai.test',
      name: 'Guardian User',
      role: 'GUARDIAN',
      organizationId: organization.id,
    },
  });
  console.log(`  Guardian: ${guardian.name} (${guardian.id})`);

  await prisma.user.update({
    where: { id: student.id },
    data: { guardianId: guardian.id },
  });
  console.log('  Guardian linked to student');

  const placeholder = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000000' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'placeholder@eduai.test',
      name: 'Placeholder User',
      role: 'TEACHER',
      organizationId: organization.id,
    },
  });
  console.log(`  Placeholder: ${placeholder.name} (${placeholder.id})`);

  const englishSection = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'English 101 — Essay Writing',
      description: 'Foundational course on academic essay writing, thesis development, and argumentation.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const englishCourse = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'English 101 — Essay Writing',
      description: 'Foundational course on academic essay writing, thesis development, and argumentation.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const englishOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: englishCourse.id, sectionId: englishSection.id },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      courseId: englishCourse.id,
      sectionId: englishSection.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const historySection = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'History 201 — Research Methods',
      description: 'Intermediate course on historical research, source evaluation, and analytical writing.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const historyCourse = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000012' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000012',
      name: 'History 201 — Research Methods',
      description: 'Intermediate course on historical research, source evaluation, and analytical writing.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const historyOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: historyCourse.id, sectionId: historySection.id },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      courseId: historyCourse.id,
      sectionId: historySection.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const scienceSection = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Science 301 — Lab Reports',
      description: 'Advanced course on scientific writing, experimental methodology, and data presentation.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const scienceCourse = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000013' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000013',
      name: 'Science 301 — Lab Reports',
      description: 'Advanced course on scientific writing, experimental methodology, and data presentation.',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const scienceOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: scienceCourse.id, sectionId: scienceSection.id },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000023',
      courseId: scienceCourse.id,
      sectionId: scienceSection.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  console.log(`  Classes: ${englishSection.name}, ${historySection.name}, ${scienceSection.name}`);

  await prisma.enrollment.upsert({
    where: { sectionId_studentId: { sectionId: englishSection.id, studentId: student.id } },
    update: {},
    create: {
      sectionId: englishSection.id,
      studentId: student.id,
      status: 'APPROVED',
    },
  });
  console.log(`  Enrollment: ${student.name} → ${englishSection.name}`);

  const essayAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: { courseOfferingId: englishOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      title: 'Persuasive Essay — AI in Education',
      description: 'Write a 500-800 word persuasive essay arguing for or against the use of AI in education.',
      dueDate: new Date('2026-08-15'),
      totalPoints: 40,
      courseOfferingId: englishOffering.id,
    },
  });

  const researchAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: { courseOfferingId: historyOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      title: 'Research Proposal — Historical Event Analysis',
      description: 'Submit a research proposal for analyzing a historical event using primary and secondary sources.',
      dueDate: new Date('2026-09-01'),
      totalPoints: 50,
      courseOfferingId: historyOffering.id,
    },
  });

  const labAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000103' },
    update: { courseOfferingId: scienceOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000103',
      title: 'Lab Report — Enzyme Kinetics Experiment',
      description: 'Write a full lab report following the standard scientific format with abstract, methods, results, and discussion.',
      dueDate: new Date('2026-09-15'),
      totalPoints: 60,
      courseOfferingId: scienceOffering.id,
    },
  });

  console.log(`  Assignments: ${essayAssignment.title}, ${researchAssignment.title}, ${labAssignment.title}`);

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    update: { assignmentId: essayAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000201',
      title: 'Persuasive Essay Rubric',
      assignmentId: essayAssignment.id,
      criteria: {
        create: [
          { description: 'Thesis clarity and focus — the essay presents a clear, specific, and arguable thesis statement.', maxPoints: 10 },
          { description: 'Quality of supporting evidence — arguments are supported with relevant, specific evidence and examples.', maxPoints: 15 },
          { description: 'Organization and structure — ideas flow logically with clear introduction, body paragraphs, and conclusion.', maxPoints: 10 },
          { description: 'Grammar and mechanics — writing is free of grammatical errors, with proper punctuation and spelling.', maxPoints: 5 },
        ],
      },
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000202' },
    update: { assignmentId: researchAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000202',
      title: 'Research Proposal Rubric',
      assignmentId: researchAssignment.id,
      criteria: {
        create: [
          { description: 'Research question — the proposal poses a focused, significant, and researchable historical question.', maxPoints: 15 },
          { description: 'Source analysis — demonstrates ability to identify, evaluate, and compare primary and secondary sources.', maxPoints: 20 },
          { description: 'Methodology — outlines a clear and appropriate approach for investigating the research question.', maxPoints: 10 },
          { description: 'Writing quality — proposal is well-organized, clearly written, and properly cited.', maxPoints: 5 },
        ],
      },
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000203' },
    update: { assignmentId: labAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000203',
      title: 'Lab Report Rubric',
      assignmentId: labAssignment.id,
      criteria: {
        create: [
          { description: 'Abstract and introduction — provides clear context, hypothesis, and overview of the experiment.', maxPoints: 10 },
          { description: 'Methods and materials — describes experimental procedure in sufficient detail for replication.', maxPoints: 15 },
          { description: 'Results and data presentation — data is accurately presented using appropriate tables, graphs, and statistics.', maxPoints: 20 },
          { description: 'Discussion and conclusion — interprets results, acknowledges limitations, and suggests future work.', maxPoints: 15 },
        ],
      },
    },
  });

  console.log('  3 rubrics created');

  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    data: { isConfirmed: true },
  });
  console.log('  Essay rubric confirmed');

  const submission = await prisma.submission.upsert({
    where: { id: '00000000-0000-0000-0000-000000000301' },
    update: { studentId: student.id, status: 'CONFIRMED', finalScore: 29 },
    create: {
      id: '00000000-0000-0000-0000-000000000301',
      assignmentId: essayAssignment.id,
      studentId: student.id,
      status: 'CONFIRMED',
      finalScore: 29,
    },
  });

  const chunks = chunkText(SAMPLE_ESSAY);
  if (chunks.length > 0) {
    await prisma.submissionChunk.deleteMany({
      where: { submissionId: submission.id },
    });
    await prisma.submissionChunk.createMany({
      data: chunks.map((content) => ({
        submissionId: submission.id,
        content,
      })),
    });
  }

  console.log(`  Submission created for "${essayAssignment.title}" (${chunks.length} chunks)`);

  const secondStudent = await prisma.user.upsert({
    where: { email: 'maya@eduai.test' },
    update: {},
    create: {
      email: 'maya@eduai.test',
      name: 'Maya Chen',
      role: 'STUDENT',
      gradeId: grade10.id,
      organizationId: organization.id,
    },
  });
  console.log(`  Student: ${secondStudent.name} (${secondStudent.id})`);

  await prisma.enrollment.upsert({
    where: {
      sectionId_studentId: { sectionId: englishSection.id, studentId: secondStudent.id },
    },
    update: {},
    create: {
      sectionId: englishSection.id,
      studentId: secondStudent.id,
      status: 'APPROVED',
    },
  });
  console.log(`  Enrollment: ${secondStudent.name} → ${englishSection.name}`);

  const essayRubric = await prisma.rubric.findUnique({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    include: { criteria: true },
  });
  const essayCriteria = essayRubric?.criteria ?? [];

  await prisma.gradingScore.createMany({
    data: essayCriteria.map((c) => ({
      submissionId: submission.id,
      criteriaId: c.id,
      pointsAwarded: Math.max(1, Math.round((c.maxPoints * 0.72) / 100)),
      isConfirmed: true,
      createdAt: new Date('2026-06-20'),
    })),
    skipDuplicates: true,
  });

  const seedSubmission = async (
    submissionId: string,
    assignmentId: string,
    studentId: string,
    pct: number,
    status: 'SUBMITTED' | 'CONFIRMED',
    createdAt: Date,
  ) => {
    const sub = await prisma.submission.upsert({
      where: { id: submissionId },
      update: {
        assignmentId,
        studentId,
        status,
        finalScore: status === 'CONFIRMED' ? Math.round(pct) : null,
      },
      create: {
        id: submissionId,
        assignmentId,
        studentId,
        status,
        finalScore: status === 'CONFIRMED' ? Math.round(pct) : null,
        createdAt,
      },
    });

    const essayChunks = chunkText(SAMPLE_ESSAY);
    if (essayChunks.length > 0) {
      await prisma.submissionChunk.deleteMany({
        where: { submissionId },
      });
      await prisma.submissionChunk.createMany({
        data: essayChunks.map((content) => ({ submissionId, content })),
      });
    }

    const confirmed = status === 'CONFIRMED';
    await prisma.gradingScore.createMany({
      data: essayCriteria.map((c) => ({
        submissionId,
        criteriaId: c.id,
        pointsAwarded: Math.max(1, Math.round((c.maxPoints * pct) / 100)),
        isConfirmed: confirmed,
        createdAt,
      })),
      skipDuplicates: true,
    });
    return sub;
  };

  await seedSubmission(
    '00000000-0000-0000-0000-000000000302',
    researchAssignment.id,
    student.id,
    72,
    'CONFIRMED',
    new Date('2026-07-01'),
  );
  await seedSubmission(
    '00000000-0000-0000-0000-000000000303',
    labAssignment.id,
    student.id,
    57,
    'CONFIRMED',
    new Date('2026-07-10'),
  );
  await seedSubmission(
    '00000000-0000-0000-0000-000000000304',
    labAssignment.id,
    secondStudent.id,
    45,
    'SUBMITTED',
    new Date('2026-07-20'),
  );
  await seedSubmission(
    '00000000-0000-0000-0000-000000000305',
    essayAssignment.id,
    secondStudent.id,
    80,
    'CONFIRMED',
    new Date('2026-07-02'),
  );
  await seedSubmission(
    '00000000-0000-0000-0000-000000000306',
    researchAssignment.id,
    secondStudent.id,
    77,
    'CONFIRMED',
    new Date('2026-07-12'),
  );
  console.log(
    '  Demo grades seeded: Sam (essay 29%, research 72%, lab 57%), Maya (essay 80%, research 77%, lab 45% pending)',
  );

  const offerings = [englishOffering, historyOffering, scienceOffering];

  await prisma.classTeacherLog.deleteMany({
    where: { courseOfferingId: { in: offerings.map((o) => o.id) } },
  });
  await prisma.classTeacherLog.createMany({
    data: offerings.map((offering) => ({
      courseOfferingId: offering.id,
      teacherId: teacher.id,
      startedAt: offering.createdAt,
    })),
  });
  console.log(`  Teacher assigned to ${offerings.length} course offerings (grade 10)`);

  const adminAuthId = await createAuthUser('admin@eduai.test', 'password123', 'Admin User');
  if (adminAuthId) {
    await prisma.user.update({
      where: { email: 'admin@eduai.test' },
      data: { authId: adminAuthId },
    });
  }

  const teacherAuthId = await createAuthUser('teacher@eduai.test', 'password123', 'Alex Mentor');
  if (teacherAuthId) {
    await prisma.user.update({
      where: { email: 'teacher@eduai.test' },
      data: { authId: teacherAuthId },
    });
  }

  const studentAuthId = await createAuthUser('student@eduai.test', 'password123', 'Sam Learner');
  if (studentAuthId) {
    await prisma.user.update({
      where: { email: 'student@eduai.test' },
      data: { authId: studentAuthId },
    });
  }

  const mayaAuthId = await createAuthUser('maya@eduai.test', 'password123', 'Maya Chen');
  if (mayaAuthId) {
    await prisma.user.update({
      where: { email: 'maya@eduai.test' },
      data: { authId: mayaAuthId },
    });
  }

  const guardianAuthId = await createAuthUser('guardian@eduai.test', 'password123', 'Guardian User');
  if (guardianAuthId) {
    await prisma.user.update({
      where: { email: 'guardian@eduai.test' },
      data: { authId: guardianAuthId },
    });
  }

  console.log('\n✅ Seed complete! IDs for Swagger testing:');
  console.log(`  Admin ID:         ${adminUser.id}`);
  console.log(`  Student ID:       ${student.id}`);
  console.log(`  Student 2 ID:     ${secondStudent.id}`);
  console.log(`  Section (English):  ${englishSection.id}`);
  console.log(`  Section (History):  ${historySection.id}`);
  console.log(`  Section (Science):  ${scienceSection.id}`);
  console.log(`  Assignment (Essay):      ${essayAssignment.id}`);
  console.log(`  Assignment (Research):   ${researchAssignment.id}`);
  console.log(`  Assignment (Lab):        ${labAssignment.id}`);
  console.log(`  Rubric (Essay):         00000000-0000-0000-0000-000000000201`);
  console.log(`  Rubric (Research):      00000000-0000-0000-0000-000000000202`);
  console.log(`  Rubric (Lab):           00000000-0000-0000-0000-000000000203`);
  console.log('  Submissions:');
  console.log('    Sam:  301 essay (CONFIRMED 29), 302 research (CONFIRMED 72), 303 lab (CONFIRMED 57)');
  console.log('    Maya: 305 essay (CONFIRMED 80), 306 research (CONFIRMED 77), 304 lab (SUBMITTED 45 — confirm me)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
