import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { chunkText } from '../src/submissions/chunker';

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

async function main() {
  console.log('Seeding database...');

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@eduai.test' },
    update: {},
    create: {
      email: 'teacher@eduai.test',
      name: 'Alex Mentor',
      role: 'TEACHER',
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
    },
  });
  console.log(`  Student: ${student.name} (${student.id})`);

  const placeholder = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0000-000000000000' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'placeholder@eduai.test',
      name: 'Placeholder User',
      role: 'TEACHER',
    },
  });
  console.log(`  Placeholder: ${placeholder.name} (${placeholder.id})`);

  const englishClass = await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'English 101 — Essay Writing',
      description: 'Foundational course on academic essay writing, thesis development, and argumentation.',
      teacherId: teacher.id,
    },
  });

  const historyClass = await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'History 201 — Research Methods',
      description: 'Intermediate course on historical research, source evaluation, and analytical writing.',
      teacherId: teacher.id,
    },
  });

  const scienceClass = await prisma.class.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Science 301 — Lab Reports',
      description: 'Advanced course on scientific writing, experimental methodology, and data presentation.',
      teacherId: teacher.id,
    },
  });

  console.log(`  Classes: ${englishClass.name}, ${historyClass.name}, ${scienceClass.name}`);

  await prisma.enrollment.upsert({
    where: { classId_studentId: { classId: englishClass.id, studentId: student.id } },
    update: {},
    create: {
      classId: englishClass.id,
      studentId: student.id,
    },
  });
  console.log(`  Enrollment: ${student.name} → ${englishClass.name}`);

  const essayAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: { classId: englishClass.id },
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      title: 'Persuasive Essay — AI in Education',
      description: 'Write a 500-800 word persuasive essay arguing for or against the use of AI in education.',
      dueDate: new Date('2026-08-15'),
      totalPoints: 40,
      classId: englishClass.id,
    },
  });

  const researchAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: { classId: historyClass.id },
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      title: 'Research Proposal — Historical Event Analysis',
      description: 'Submit a research proposal for analyzing a historical event using primary and secondary sources.',
      dueDate: new Date('2026-09-01'),
      totalPoints: 50,
      classId: historyClass.id,
    },
  });

  const labAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000103' },
    update: { classId: scienceClass.id },
    create: {
      id: '00000000-0000-0000-0000-000000000103',
      title: 'Lab Report — Enzyme Kinetics Experiment',
      description: 'Write a full lab report following the standard scientific format with abstract, methods, results, and discussion.',
      dueDate: new Date('2026-09-15'),
      totalPoints: 60,
      classId: scienceClass.id,
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

  const submission = await prisma.submission.upsert({
    where: { id: '00000000-0000-0000-0000-000000000301' },
    update: { studentId: student.id },
    create: {
      id: '00000000-0000-0000-0000-000000000301',
      assignmentId: essayAssignment.id,
      studentId: student.id,
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

  console.log('\n✅ Seed complete! IDs for Swagger testing:');
  console.log(`  Teacher ID:       ${teacher.id}`);
  console.log(`  Student ID:       ${student.id}`);
  console.log(`  Class (English):  ${englishClass.id}`);
  console.log(`  Class (History):  ${historyClass.id}`);
  console.log(`  Class (Science):  ${scienceClass.id}`);
  console.log(`  Assignment (Essay):      ${essayAssignment.id}`);
  console.log(`  Assignment (Research):   ${researchAssignment.id}`);
  console.log(`  Assignment (Lab):        ${labAssignment.id}`);
  console.log(`  Rubric (Essay):         00000000-0000-0000-0000-000000000201`);
  console.log(`  Rubric (Research):      00000000-0000-0000-0000-000000000202`);
  console.log(`  Rubric (Lab):           00000000-0000-0000-0000-000000000203`);
  console.log(`  Submission:             00000000-0000-0000-0000-000000000301`);
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
