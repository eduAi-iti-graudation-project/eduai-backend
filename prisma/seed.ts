import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { chunkText } from '../src/common/chunker';
import { encryptSsn, ssnTail4 } from '../src/common/crypto/ssn';
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
    console.warn(
      `  ⚠ SUPABASE_URL or SUPABASE_SERVICE_KEY not set, skipping auth for ${email}`,
    );
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
  if (
    error?.status === 409 ||
    error?.message?.includes('already been registered')
  ) {
    const { data: signIn } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signIn?.user?.id) return signIn.user.id;
  }

  console.warn(
    `  ⚠ Auth user creation skipped for ${email}: ${error?.message ?? 'unknown error'}`,
  );
  return null;
}

/** WP6: run async tasks in chunks of `batchSize` (Supabase calls are HTTP-bound). */
async function runBatched<T>(
  tasks: Array<() => Promise<T>>,
  batchSize = 10,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map((task) => task()))));
  }
  return results;
}

async function upsertStudent(input: {
  email: string;
  name: string;
  gradeId: string;
  organizationId: string;
  guardianId?: string;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      name: input.name,
      role: 'STUDENT',
      gradeId: input.gradeId,
      organizationId: input.organizationId,
      ...(input.guardianId ? { guardianId: input.guardianId } : {}),
    },
  });
}

async function upsertEnrollment(sectionId: string, studentId: string) {
  await prisma.enrollment.upsert({
    where: { sectionId_studentId: { sectionId, studentId } },
    update: { status: 'APPROVED' },
    create: { sectionId, studentId, status: 'APPROVED' },
  });
}

function schoolDays(ending: Date, count: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(ending);
  while (days.length < count) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days.unshift(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

async function seedAttendance(
  sectionId: string,
  studentId: string,
  days: Date[],
) {
  const options: Array<{
    status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
    ratio: number;
  }> = [
    { status: 'PRESENT', ratio: 0.82 },
    { status: 'LATE', ratio: 0.1 },
    { status: 'ABSENT', ratio: 0.05 },
    { status: 'EXCUSED', ratio: 0.03 },
  ];
  let roll = 0;
  await prisma.attendance.createMany({
    data: days.map((date) => {
      let acc = 0;
      let status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' = 'PRESENT';
      for (const option of options) {
        acc += option.ratio;
        if (roll < acc * 100) {
          status = option.status;
          break;
        }
      }
      roll = (roll + 1) % 100;
      return { sectionId, studentId, date, status };
    }),
    skipDuplicates: true,
  });
}

async function upsertTeacherProfile(
  teacherId: string,
  profile: {
    ssn: string;
    phone: string;
    street: string;
    city: string;
    nationality: string;
    personalEmail: string;
    dateOfBirth: Date;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelationship: string;
  },
) {
  const data = {
    ssnEncrypted: encryptSsn(profile.ssn),
    ssnTail4: ssnTail4(profile.ssn),
    phone: profile.phone,
    street: profile.street,
    city: profile.city,
    nationality: profile.nationality,
    personalEmail: profile.personalEmail,
    dateOfBirth: profile.dateOfBirth,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    emergencyContactRelationship: profile.emergencyContactRelationship,
  };
  await prisma.teacherProfile.upsert({
    where: { teacherId },
    update: data,
    create: { teacherId, ...data },
  });
}

/**
 * Fixture for the struggle-signal extraction agent: a fully-recorded CLASS
 * meeting whose per-participant transcript is an Arabic lesson on projectile
 * motion (multilingual input path). Attached to the offering that owns the
 * "Mechanics — Projectile Motion Basics" material so quiz / re-explanation
 * generation can ground in curriculum chunks. Three students show confusion
 * on the same concept on purpose → exercises the class-wide rollup (>= 3).
 * Extraction itself is triggered via POST meetings/:id/struggle-signals/extract.
 */
async function seedArabicTranscriptFixture(orgId: string) {
  const MEETING_ID = '00000000-0000-0000-0000-000000000041';
  const OFFERING_ID = '00000000-0000-0000-0000-000000000021';

  const teacher = await prisma.user.findUniqueOrThrow({
    where: { email: 'teacher@eduai.test' },
  });
  const [sam, maya, omar, chris] = await Promise.all(
    [
      'student@eduai.test',
      'maya@eduai.test',
      'omar.haddad@eduai.test',
      'chris.miller@eduai.test',
    ].map((email) => prisma.user.findUniqueOrThrow({ where: { email } })),
  );

  await prisma.meeting.deleteMany({ where: { id: MEETING_ID } });

  await prisma.meeting.create({
    data: {
      id: MEETING_ID,
      organizationId: orgId,
      title: 'Physics — Projectile Motion (Arabic demo)',
      type: 'CLASS',
      courseOfferingId: OFFERING_ID,
      createdBy: teacher.id,
      scheduledStart: new Date('2026-08-05T09:00:00Z'),
      scheduledEnd: new Date('2026-08-05T09:45:00Z'),
      status: 'ENDED',
      roomName: 'meet-arabic-projectile-demo',
      recordingEnabled: true,
      transcriptStatus: 'READY',
      pendingParticipantTranscripts: 0,
      struggleSignalsProcessed: false,
    },
  });

  const segments: Array<{
    userId: string;
    role: 'TEACHER' | 'STUDENT';
    timestamp: number;
    text: string;
  }> = [
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 0,
      text: 'طيب يا شباب، النهارده هناخد درس جديد اسمه حركة المقذوفات، يعني لما نرمي أي جسم في الهواء بزاوية معينة.',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 8,
      text: 'السرعة بتتحلل لمركبتين: مركبة أفقية ثابتة، ومركبة رأسية بتتأثر بالجاذبية.',
    },
    {
      userId: omar.id,
      role: 'STUDENT',
      timestamp: 15,
      text: 'أستاذ، عندي سؤال. يعني إيه مركبة أفقية ثابتة؟ السرعة مش المفروض تقل مع الوقت؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 22,
      text: 'سؤال حلو يا عمر. السرعة الأفقية مالهاش علاقة بالجاذبية، فهي بتحافظ على قيمتها لو أهملنا مقاومة الهواء.',
    },
    {
      userId: maya.id,
      role: 'STUDENT',
      timestamp: 30,
      text: 'أنا لسه مش مقتنعة... لو الجسم بيتحرك في الهواء أكيد في حاجة بتوقفه، إزاي السرعة الأفقية متتغيرش؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 38,
      text: 'شوفي يا مها، الجاذبية بتسحب الجسم للتحت بس، مش لورا. فمفيش قوة بتأثر على الحركة الأفقية.',
    },
    {
      userId: chris.id,
      role: 'STUDENT',
      timestamp: 45,
      text: 'يعني لو رميت كرة أفقية وكرة وقعت من نفس الارتفاع في نفس اللحظة، هما هيوصلوا الأرض مع بعض؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 52,
      text: 'أيوة بالظبط! الزمن في الاتجاهين بيبقى نفس القيمة، لأن الزمن بيعتمد على الحركة الرأسية بس.',
    },
    {
      userId: sam.id,
      role: 'STUDENT',
      timestamp: 60,
      text: 'فهمت جزء... بس عندي سؤال عن أعلى نقطة. لما المقذوف يوصل لأعلى نقطة، السرعة الكلية بتبقى صفر؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 68,
      text: 'هنا نقطة مهمة جدًا. عند أعلى نقطة، المركبة الرأسية صفر، لكن المركبة الأفقية لسه موجودة.',
    },
    {
      userId: omar.id,
      role: 'STUDENT',
      timestamp: 75,
      text: 'إزاي يعني؟ يعني الجسم مش واقف عند أعلى نقطة؟ لو السرعة الرأسية صفر، المفروض الجسم يقف ثواني؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 83,
      text: 'لأ، الجسم مش بيقف. الفكرة إن الحركة الأفقية لسه شغالة، فالجسم بيتحرك جنب بجنب وهو نازل.',
    },
    {
      userId: maya.id,
      role: 'STUDENT',
      timestamp: 90,
      text: 'أستاذ أنا لسه مش فاهمة يعني إيه حركة أفقية وشغالة، فين القوة اللي بتخليها شغالة؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 97,
      text: 'مفيش قوة أفقية أصلًا — وده بالظبط اللي بيخلي السرعة الأفقية ثابتة. الجسم هيحافظ على سرعته الأفقية.',
    },
    {
      userId: chris.id,
      role: 'STUDENT',
      timestamp: 105,
      text: 'طب والجاذبية؟ إحنا قلنا الجاذبية بتأثر على الحركة الرأسية، بس إزاي بالظبط بتغير شكل المسار؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 112,
      text: 'الجاذبية بتغير السرعة الرأسية بمعدل ثابت، فالمسار بيطلع منحنى اسمه قطع مكافئ.',
    },
    {
      userId: omar.id,
      role: 'STUDENT',
      timestamp: 120,
      text: 'قطع مكافئ... يعني دي الإجابة عن سبب مسار الكرة اللي بيناها في التمرين، صح؟ بس أنا كنت فاكر إنها بتمشي خط مستقيم وتنزل مفاجأة.',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 128,
      text: 'أيوة، كتير من الناس بيتخيلوا كده، بس الحقيقة إن المسار كله منحني من أول رمية.',
    },
    {
      userId: sam.id,
      role: 'STUDENT',
      timestamp: 135,
      text: 'عندي مثال أتأكد منه: لو رميت الكرة بزاوية 45 درجة، المدى بيبقى أقصى ما يمكن؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 142,
      text: 'إكسيلنت! صح، زاوية 45 بيدي أقصى مدى لو الأرض مسطحة — كويس إنك فاكر ده.',
    },
    {
      userId: maya.id,
      role: 'STUDENT',
      timestamp: 150,
      text: 'أنا لسه مش فاهمة ليه السرعة الأفقية ثابتة بس الرأسية بتتغير... يعني مش المفروض الاتنين يتأثروا بنفس القوة؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 158,
      text: 'إحنا قلنا الجاذبية بتشتغل راسي بس. فاللي بيتأثر بالجاذبية هو السرعة الرأسية فقط.',
    },
    {
      userId: chris.id,
      role: 'STUDENT',
      timestamp: 165,
      text: 'طب لو الجاذبية بتأثر على الرأسية بس، إزاي المقذوف بيتحرك لورا خالص؟ طب مين اللي بيوقف الحركة الأفقية في الآخر؟',
    },
    {
      userId: teacher.id,
      role: 'TEACHER',
      timestamp: 172,
      text: 'في الواقع مقاومة الهواء والأرض هي اللي بتوقف الحركة الأفقية. لكن لو إحنا في فراغ، المقذوف بيكمل لمدى أبعد.',
    },
  ];

  await prisma.meetingTranscriptSegment.createMany({
    data: segments.map((s) => ({ meetingId: MEETING_ID, ...s })),
  });
  console.log(
    `  Arabic transcript fixture: meeting ${MEETING_ID} (${segments.length} segments, 4 students)`,
  );
}

const PROJECTILE_MATERIAL_TEXT = `Projectile Motion Basics

A projectile is any object launched into the air and allowed to move under the influence of gravity alone, ignoring air resistance. Examples include a kicked football, a thrown basketball, or a ball rolled off a table.

Horizontal and vertical motion are independent. The velocity of a projectile can be split into two components: a horizontal component and a vertical component. The horizontal component stays constant throughout the flight because gravity acts only vertically — no horizontal force acts on the projectile (when air resistance is ignored). The vertical component changes at a constant rate because gravity accelerates the projectile downward at about 9.8 m/s².

The path of a projectile is a parabola. Because the horizontal motion proceeds at constant speed while the vertical motion accelerates, the combination produces a curved trajectory called a parabolic path. The projectile begins moving along the curve from the very first instant; it does not travel in a straight line and then suddenly fall.

At the highest point of the trajectory, the vertical velocity is zero, but the horizontal velocity is still present. This is why the projectile keeps moving sideways even at the apex — it does not stop or hover. The time to reach the highest point equals the time to fall back from it, assuming level ground.

The range is the horizontal distance travelled. For a given launch speed on level ground, the maximum range is achieved at a 45-degree launch angle. In reality, air resistance and the ground stop the horizontal motion eventually, but in a vacuum a projectile would keep travelling much farther.`;

/**
 * Embed a batch of chunk texts via the same HuggingFace router the app uses
 * (materials.service embeds each chunk on upload). Returns 1024-dim vectors.
 */
async function hfEmbedChunks(texts: string[]): Promise<number[][]> {
  const token = process.env.HF_TOKEN;
  const model =
    process.env.HF_EMBED_MODEL || 'mixedbread-ai/mxbai-embed-large-v1';
  if (!token) throw new Error('HF_TOKEN is not set');
  const response = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ inputs: texts }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `HuggingFace embed failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as number[][];
}

/**
 * Recreates the "Mechanics — Projectile Motion Basics" curriculum material on
 * offering ...021 (deleted along with the offering by the seed's cleanup step).
 * The struggle-signal dispatch grounds quizzes / re-explanations in these
 * chunks (vector search), so they are embedded like real uploads.
 */
async function seedProjectileMaterial() {
  const MATERIAL_ID = '00000000-0000-0000-0000-000000000301';
  const OFFERING_ID = '00000000-0000-0000-0000-000000000021';

  const contents = chunkText(PROJECTILE_MATERIAL_TEXT);
  await prisma.material.deleteMany({ where: { id: MATERIAL_ID } });
  await prisma.material.create({
    data: {
      id: MATERIAL_ID,
      title: 'Mechanics — Projectile Motion Basics',
      fileUrl: 'projectile.txt',
      courseOfferingId: OFFERING_ID,
      chunks: {
        create: contents.map((content) => ({ content })),
      },
    },
  });

  const chunkIds = (
    await prisma.materialChunk.findMany({
      where: { materialId: MATERIAL_ID },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
  ).map((c) => c.id);
  const embeddings = await hfEmbedChunks(contents);
  for (let i = 0; i < chunkIds.length; i++) {
    await pool.query(
      `UPDATE material_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
      [`[${embeddings[i].join(',')}]`, chunkIds[i]],
    );
  }
  console.log(
    `  Projectile material fixture: ${MATERIAL_ID} (${chunkIds.length} embedded chunks)`,
  );
}

async function main() {
  console.log('Seeding database...');
  const FAST = process.argv.includes('--fast');
  if (FAST)
    console.log('  Fast mode: skipping attendance + submission fixtures');

  const SEEDED_OFFERING_IDS = [
    '00000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000023',
    '00000000-0000-0000-0000-000000000024',
    '00000000-0000-0000-0000-000000000025',
    '00000000-0000-0000-0000-000000000026',
    '00000000-0000-0000-0000-000000000027',
    '00000000-0000-0000-0000-000000000028',
    '00000000-0000-0000-0000-000000000029',
    '00000000-0000-0000-0000-000000000030',
    '00000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000032',
    '00000000-0000-0000-0000-000000000033',
    '00000000-0000-0000-0000-000000000034',
  ];
  await prisma.courseOffering.deleteMany({
    where: { id: { in: SEEDED_OFFERING_IDS } },
  });

  const organization = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-00000000a001' },
    update: {
      joinCode: 'DEMO2026',
      emailDomain: 'demo.org',
      subscriptionTier: 'ENTERPRISE',
      subscriptionStatus: 'TRIALING',
    },
    create: {
      id: '00000000-0000-0000-0000-00000000a001',
      name: 'Demo School',
      joinCode: 'DEMO2026',
      emailDomain: 'demo.org',
      subscriptionTier: 'ENTERPRISE',
      subscriptionStatus: 'TRIALING',
      seatLimit: 50,
    },
  });
  console.log(`  Organization: ${organization.name} (${organization.id})`);

  // WP5/WP6: demo SchoolGroup exercises the grouped-billing path and gives
  // the demo org a fresh trial window (group createdAt), so the guards never
  // lock the demo out.
  const group = await prisma.schoolGroup.upsert({
    where: { id: '00000000-0000-0000-0000-00000000b001' },
    update: {
      name: 'EduAI Demo Group',
      subscriptionTier: 'ENTERPRISE',
      subscriptionStatus: 'TRIALING',
    },
    create: {
      id: '00000000-0000-0000-0000-00000000b001',
      name: 'EduAI Demo Group',
      subscriptionTier: 'ENTERPRISE',
      subscriptionStatus: 'TRIALING',
      seatLimit: 50,
    },
  });
  await prisma.organization.update({
    where: { id: organization.id },
    data: { groupId: group.id },
  });
  console.log(`  SchoolGroup: ${group.name} (${group.id})`);

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
      where: {
        organizationId_level: { organizationId: organization.id, level },
      },
      update: { name: `Grade ${level}` },
      create: {
        organizationId: organization.id,
        level,
        name: `Grade ${level}`,
      },
    });
  }
  console.log('  Grades 1–12 created');

  const grade10 = await prisma.gradeLevel.findUniqueOrThrow({
    where: {
      organizationId_level: { organizationId: organization.id, level: 10 },
    },
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

  const dana = await prisma.user.upsert({
    where: { email: 'd.smith@eduai.test' },
    update: {},
    create: {
      email: 'd.smith@eduai.test',
      name: 'Dana Smith',
      role: 'TEACHER',
      gender: 'FEMALE',
      organizationId: organization.id,
    },
  });
  console.log(`  Teacher: ${dana.name} (${dana.id})`);

  const raj = await prisma.user.upsert({
    where: { email: 'r.patel@eduai.test' },
    update: {},
    create: {
      email: 'r.patel@eduai.test',
      name: 'Raj Patel',
      role: 'TEACHER',
      gender: 'MALE',
      organizationId: organization.id,
    },
  });
  console.log(`  Teacher: ${raj.name} (${raj.id})`);

  await upsertTeacherProfile(teacher.id, {
    ssn: '123-45-6789',
    phone: '+20 103 555 4412',
    street: '12 Nile Corniche, Garden City',
    city: 'Cairo',
    nationality: 'Egyptian',
    personalEmail: 'alex.mentor@gmail.com',
    dateOfBirth: new Date('1994-03-14'),
    emergencyContactName: 'Nour El-Mentor',
    emergencyContactPhone: '+20 100 555 4412',
    emergencyContactRelationship: 'Spouse',
  });

  await upsertTeacherProfile(dana.id, {
    ssn: '988-12-9876',
    phone: '+20 100 555 9876',
    street: '14 Zamalek Towers, 26th July St',
    city: 'Cairo',
    nationality: 'Egyptian',
    personalEmail: 'dana.smith@gmail.com',
    dateOfBirth: new Date('1992-07-02'),
    emergencyContactName: 'Mark Smith',
    emergencyContactPhone: '+20 101 555 9876',
    emergencyContactRelationship: 'Brother',
  });

  await upsertTeacherProfile(raj.id, {
    ssn: '789-01-2345',
    phone: '+20 109 555 3344',
    street: '87 Corniche El-Nil, Dokki',
    city: 'Giza',
    nationality: 'Egyptian',
    personalEmail: 'raj.patel@gmail.com',
    dateOfBirth: new Date('1988-09-26'),
    emergencyContactName: 'Priya Patel',
    emergencyContactPhone: '+20 102 555 3344',
    emergencyContactRelationship: 'Spouse',
  });
  console.log('  Teacher profiles seeded (SSN encrypted, personal fields)');

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

  const sec10a = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { gradeLevelId: grade10.id, name: 'Section A' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Section A',
      description: 'Grade 10 — Section A',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const sec10b = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: { gradeLevelId: grade10.id, name: 'Section B' },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Section B',
      description: 'Grade 10 — Section B',
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
      description:
        'Foundational course on academic essay writing, thesis development, and argumentation.',
      colorTag: '#3B82F6',
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
      description:
        'Intermediate course on historical research, source evaluation, and analytical writing.',
      colorTag: '#0D9488',
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
      description:
        'Advanced course on scientific writing, experimental methodology, and data presentation.',
      colorTag: '#EC4899',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const mathCourse10 = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000014' },
    update: { gradeLevelId: grade10.id },
    create: {
      id: '00000000-0000-0000-0000-000000000014',
      name: 'Mathematics 10 — Algebra & Geometry',
      description:
        'Core mathematics covering algebra, linear equations, and introductory geometry.',
      colorTag: '#F59E0B',
      gradeLevelId: grade10.id,
      organizationId: organization.id,
    },
  });

  const grade11 = await prisma.gradeLevel.findUniqueOrThrow({
    where: {
      organizationId_level: { organizationId: organization.id, level: 11 },
    },
  });

  const sec11a = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000005' },
    update: { gradeLevelId: grade11.id, name: 'Section A' },
    create: {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'Section A',
      description: 'Grade 11 — Section A',
      gradeLevelId: grade11.id,
      organizationId: organization.id,
    },
  });

  const sec11b = await prisma.section.upsert({
    where: { id: '00000000-0000-0000-0000-000000000006' },
    update: { gradeLevelId: grade11.id, name: 'Section B' },
    create: {
      id: '00000000-0000-0000-0000-000000000006',
      name: 'Section B',
      description: 'Grade 11 — Section B',
      gradeLevelId: grade11.id,
      organizationId: organization.id,
    },
  });

  const englishCourse11 = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000015' },
    update: { gradeLevelId: grade11.id },
    create: {
      id: '00000000-0000-0000-0000-000000000015',
      name: 'English 11 — Literature & Composition',
      description: 'Advanced literature analysis and expository composition.',
      colorTag: '#8B5CF6',
      gradeLevelId: grade11.id,
      organizationId: organization.id,
    },
  });

  const mathCourse11 = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000016' },
    update: { gradeLevelId: grade11.id },
    create: {
      id: '00000000-0000-0000-0000-000000000016',
      name: 'Mathematics 11 — Pre-Calculus',
      description:
        'Trigonometry, sequences, and an introduction to calculus concepts.',
      colorTag: '#10B981',
      gradeLevelId: grade11.id,
      organizationId: organization.id,
    },
  });

  const physicsCourse11 = await prisma.course.upsert({
    where: { id: '00000000-0000-0000-0000-000000000017' },
    update: { gradeLevelId: grade11.id },
    create: {
      id: '00000000-0000-0000-0000-000000000017',
      name: 'Physics 11 — Mechanics & Waves',
      description: 'Newtonian mechanics, energy, momentum, and wave phenomena.',
      colorTag: '#06B6D4',
      gradeLevelId: grade11.id,
      organizationId: organization.id,
    },
  });

  // ── Course offerings — sections × courses (Grade 10) ──────
  const englishOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: englishCourse.id, sectionId: sec10a.id },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      courseId: englishCourse.id,
      sectionId: sec10a.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const historyOffering10a = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: historyCourse.id, sectionId: sec10a.id },
    },
    update: { teacherId: raj.id },
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      courseId: historyCourse.id,
      sectionId: sec10a.id,
      teacherId: raj.id,
      organizationId: organization.id,
    },
  });

  const scienceOffering10a = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: scienceCourse.id, sectionId: sec10a.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000023',
      courseId: scienceCourse.id,
      sectionId: sec10a.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  const mathOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: mathCourse10.id, sectionId: sec10a.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000024',
      courseId: mathCourse10.id,
      sectionId: sec10a.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  const englishOffering10b = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: englishCourse.id, sectionId: sec10b.id },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000028',
      courseId: englishCourse.id,
      sectionId: sec10b.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const historyOffering = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: historyCourse.id, sectionId: sec10b.id },
    },
    update: { teacherId: raj.id },
    create: {
      id: '00000000-0000-0000-0000-000000000029',
      courseId: historyCourse.id,
      sectionId: sec10b.id,
      teacherId: raj.id,
      organizationId: organization.id,
    },
  });

  const scienceOffering10b = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: scienceCourse.id, sectionId: sec10b.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000030',
      courseId: scienceCourse.id,
      sectionId: sec10b.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  const mathOffering10b = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: mathCourse10.id, sectionId: sec10b.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000031',
      courseId: mathCourse10.id,
      sectionId: sec10b.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  // ── Course offerings — sections × courses (Grade 11) ──────
  const englishOffering11 = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: {
        courseId: englishCourse11.id,
        sectionId: sec11a.id,
      },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000025',
      courseId: englishCourse11.id,
      sectionId: sec11a.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const mathOffering11a = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: mathCourse11.id, sectionId: sec11a.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000026',
      courseId: mathCourse11.id,
      sectionId: sec11a.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  const physicsOffering11a = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: {
        courseId: physicsCourse11.id,
        sectionId: sec11a.id,
      },
    },
    update: { teacherId: raj.id },
    create: {
      id: '00000000-0000-0000-0000-000000000027',
      courseId: physicsCourse11.id,
      sectionId: sec11a.id,
      teacherId: raj.id,
      organizationId: organization.id,
    },
  });

  const englishOffering11b = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: {
        courseId: englishCourse11.id,
        sectionId: sec11b.id,
      },
    },
    update: { teacherId: teacher.id },
    create: {
      id: '00000000-0000-0000-0000-000000000032',
      courseId: englishCourse11.id,
      sectionId: sec11b.id,
      teacherId: teacher.id,
      organizationId: organization.id,
    },
  });

  const mathOffering11 = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: { courseId: mathCourse11.id, sectionId: sec11b.id },
    },
    update: { teacherId: dana.id },
    create: {
      id: '00000000-0000-0000-0000-000000000033',
      courseId: mathCourse11.id,
      sectionId: sec11b.id,
      teacherId: dana.id,
      organizationId: organization.id,
    },
  });

  const physicsOffering11 = await prisma.courseOffering.upsert({
    where: {
      courseId_sectionId: {
        courseId: physicsCourse11.id,
        sectionId: sec11b.id,
      },
    },
    update: { teacherId: raj.id },
    create: {
      id: '00000000-0000-0000-0000-000000000034',
      courseId: physicsCourse11.id,
      sectionId: sec11b.id,
      teacherId: raj.id,
      organizationId: organization.id,
    },
  });

  console.log(
    `  Sections: ${sec10a.name}, ${sec10b.name}, ${sec11a.name}, ${sec11b.name} — each with ${[englishCourse, historyCourse, scienceCourse, mathCourse10, englishCourse11, mathCourse11, physicsCourse11].length} grade courses across ${14} offerings`,
  );

  const essayAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: { courseOfferingId: englishOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      title: 'Persuasive Essay — AI in Education',
      description:
        'Write a 500-800 word persuasive essay arguing for or against the use of AI in education.',
      dueDate: new Date('2026-08-15'),
      totalPoints: 40,
      courseOfferingId: englishOffering.id,
    },
  });

  const researchAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: { courseOfferingId: historyOffering10a.id },
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      title: 'Research Proposal — Historical Event Analysis',
      description:
        'Submit a research proposal for analyzing a historical event using primary and secondary sources.',
      dueDate: new Date('2026-09-01'),
      totalPoints: 50,
      courseOfferingId: historyOffering10a.id,
    },
  });

  const labAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000103' },
    update: { courseOfferingId: scienceOffering10a.id },
    create: {
      id: '00000000-0000-0000-0000-000000000103',
      title: 'Lab Report — Enzyme Kinetics Experiment',
      description:
        'Write a full lab report following the standard scientific format with abstract, methods, results, and discussion.',
      dueDate: new Date('2026-09-15'),
      totalPoints: 60,
      courseOfferingId: scienceOffering10a.id,
    },
  });

  console.log(
    `  Assignments: ${essayAssignment.title}, ${researchAssignment.title}, ${labAssignment.title}`,
  );

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    update: { assignmentId: essayAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000201',
      title: 'Persuasive Essay Rubric',
      assignmentId: essayAssignment.id,
      criteria: {
        create: [
          {
            description:
              'Thesis clarity and focus — the essay presents a clear, specific, and arguable thesis statement.',
            maxPoints: 10,
          },
          {
            description:
              'Quality of supporting evidence — arguments are supported with relevant, specific evidence and examples.',
            maxPoints: 15,
          },
          {
            description:
              'Organization and structure — ideas flow logically with clear introduction, body paragraphs, and conclusion.',
            maxPoints: 10,
          },
          {
            description:
              'Grammar and mechanics — writing is free of grammatical errors, with proper punctuation and spelling.',
            maxPoints: 5,
          },
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
          {
            description:
              'Research question — the proposal poses a focused, significant, and researchable historical question.',
            maxPoints: 15,
          },
          {
            description:
              'Source analysis — demonstrates ability to identify, evaluate, and compare primary and secondary sources.',
            maxPoints: 20,
          },
          {
            description:
              'Methodology — outlines a clear and appropriate approach for investigating the research question.',
            maxPoints: 10,
          },
          {
            description:
              'Writing quality — proposal is well-organized, clearly written, and properly cited.',
            maxPoints: 5,
          },
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
          {
            description:
              'Abstract and introduction — provides clear context, hypothesis, and overview of the experiment.',
            maxPoints: 10,
          },
          {
            description:
              'Methods and materials — describes experimental procedure in sufficient detail for replication.',
            maxPoints: 15,
          },
          {
            description:
              'Results and data presentation — data is accurately presented using appropriate tables, graphs, and statistics.',
            maxPoints: 20,
          },
          {
            description:
              'Discussion and conclusion — interprets results, acknowledges limitations, and suggests future work.',
            maxPoints: 15,
          },
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

  console.log(
    `  Submission created for "${essayAssignment.title}" (${chunks.length} chunks)`,
  );

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

  // ── Additional students + guardians ────────────────────────
  const linda = await prisma.user.upsert({
    where: { email: 'linda.miller@eduai.test' },
    update: {},
    create: {
      email: 'linda.miller@eduai.test',
      name: 'Linda Miller',
      role: 'GUARDIAN',
      organizationId: organization.id,
    },
  });

  const hana = await prisma.user.upsert({
    where: { email: 'hana.haddad@eduai.test' },
    update: {},
    create: {
      email: 'hana.haddad@eduai.test',
      name: 'Hana Haddad',
      role: 'GUARDIAN',
      organizationId: organization.id,
    },
  });

  const chris = await upsertStudent({
    email: 'chris.miller@eduai.test',
    name: 'Chris Miller',
    gradeId: grade10.id,
    organizationId: organization.id,
    guardianId: linda.id,
  });
  const sara = await upsertStudent({
    email: 'sara.kim@eduai.test',
    name: 'Sara Kim',
    gradeId: grade10.id,
    organizationId: organization.id,
  });
  const omar = await upsertStudent({
    email: 'omar.haddad@eduai.test',
    name: 'Omar Haddad',
    gradeId: grade10.id,
    organizationId: organization.id,
    guardianId: hana.id,
  });
  const ethan = await upsertStudent({
    email: 'ethan.johnson@eduai.test',
    name: 'Ethan Johnson',
    gradeId: grade11.id,
    organizationId: organization.id,
  });
  const liam = await upsertStudent({
    email: 'liam.brown@eduai.test',
    name: 'Liam Brown',
    gradeId: grade11.id,
    organizationId: organization.id,
  });
  const ava = await upsertStudent({
    email: 'ava.wilson@eduai.test',
    name: 'Ava Wilson',
    gradeId: grade11.id,
    organizationId: organization.id,
  });
  const noor = await upsertStudent({
    email: 'noor.hassan@eduai.test',
    name: 'Noor Hassan',
    gradeId: grade11.id,
    organizationId: organization.id,
  });
  const zoe = await upsertStudent({
    email: 'zoe.taylor@eduai.test',
    name: 'Zoe Taylor',
    gradeId: grade11.id,
    organizationId: organization.id,
  });
  console.log(
    '  Students seeded: Chris, Sara, Omar (G10), Ethan, Liam, Ava, Noor, Zoe (G11)',
  );

  await Promise.all([
    upsertEnrollment(sec10a.id, student.id),
    upsertEnrollment(sec10b.id, secondStudent.id),
    upsertEnrollment(sec10a.id, chris.id),
    upsertEnrollment(sec10b.id, sara.id),
    upsertEnrollment(sec10a.id, omar.id),
    upsertEnrollment(sec11b.id, ethan.id),
    upsertEnrollment(sec11a.id, liam.id),
    upsertEnrollment(sec11a.id, ava.id),
    upsertEnrollment(sec11b.id, noor.id),
    upsertEnrollment(sec11a.id, zoe.id),
  ]);
  console.log(
    '  Enrollments: 10 students, one section each (G10 round-robin: Chris/Sam/Omar → 10A, Maya/Sara → 10B; G11: Liam/Ava/Zoe → 11A, Ethan/Noor → 11B)',
  );

  const attendanceDays = schoolDays(new Date('2026-08-28'), 15);
  const attendancePairs: Array<[string, string]> = [
    [sec10a.id, student.id],
    [sec10a.id, chris.id],
    [sec10a.id, omar.id],
    [sec10b.id, secondStudent.id],
    [sec10b.id, sara.id],
    [sec11a.id, liam.id],
    [sec11a.id, ava.id],
    [sec11a.id, zoe.id],
    [sec11b.id, ethan.id],
    [sec11b.id, noor.id],
  ];
  for (const [sectionId, studentId] of attendancePairs) {
    if (!FAST) await seedAttendance(sectionId, studentId, attendanceDays);
  }
  console.log(
    `  Attendance: ${attendancePairs.length} student-section pairs × ${attendanceDays.length} school days${FAST ? ' (skipped)' : ''}`,
  );

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

  const mathAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000104' },
    update: { courseOfferingId: mathOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000104',
      title: 'Linear Algebra — Problem Set 1',
      description:
        'Solve systems of linear equations and sketch their geometric interpretations.',
      dueDate: new Date('2026-09-20'),
      totalPoints: 40,
      courseOfferingId: mathOffering.id,
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000204' },
    update: { assignmentId: mathAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000204',
      title: 'Problem Set 1 Rubric',
      assignmentId: mathAssignment.id,
      criteria: {
        create: [
          {
            description:
              'Correct equation setup — systems are modeled correctly from word problems.',
            maxPoints: 10,
          },
          {
            description:
              'Solution accuracy — computations are correct with clear steps shown.',
            maxPoints: 15,
          },
          {
            description:
              'Geometric interpretation — solutions are correctly sketched on the coordinate plane.',
            maxPoints: 10,
          },
          {
            description:
              'Clarity and notation — work is legible with proper mathematical notation.',
            maxPoints: 5,
          },
        ],
      },
    },
  });

  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000204' },
    data: { isConfirmed: true },
  });

  const mathRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000204' },
    include: { criteria: true },
  });
  const mathCriteria = mathRubric.criteria;
  console.log(`  Math assignment + rubric: ${mathAssignment.title}`);

  // ── Grade 10 English — Poetry Analysis Essay ─────────────────
  const poetryAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000105' },
    update: { courseOfferingId: englishOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000105',
      title: 'Poetry Analysis Essay — The Road Not Taken',
      description:
        'Write a 600-800 word analytical essay on Robert Frost\'s "The Road Not Taken", focusing on theme, imagery, and tone.',
      dueDate: new Date('2026-08-28'),
      totalPoints: 40,
      courseOfferingId: englishOffering.id,
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000205' },
    update: { assignmentId: poetryAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000205',
      title: 'Poetry Analysis Rubric',
      assignmentId: poetryAssignment.id,
      criteria: {
        create: [
          {
            description:
              "Theme interpretation — presents a thoughtful and defensible reading of the poem's central theme.",
            maxPoints: 10,
          },
          {
            description:
              'Textual evidence — quotes and analyzes specific lines with close reading.',
            maxPoints: 15,
          },
          {
            description:
              'Literary devices — identifies and explains symbolism, imagery, and tone.',
            maxPoints: 10,
          },
          {
            description:
              'Mechanics and style — clear prose, correct grammar, and proper MLA citation.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000205' },
    data: { isConfirmed: true },
  });
  const poetryRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000205' },
    include: { criteria: true },
  });
  const poetryCriteria = poetryRubric.criteria;

  // ── Grade 11 English — Literary Analysis Essay ──────────────
  const literaryAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000106' },
    update: { courseOfferingId: englishOffering11.id },
    create: {
      id: '00000000-0000-0000-0000-000000000106',
      title: 'Literary Analysis — Character Development',
      description:
        'Write a 600-800 word analysis of how a chosen character changes across a full novel read in class.',
      dueDate: new Date('2026-09-05'),
      totalPoints: 40,
      courseOfferingId: englishOffering11.id,
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000206' },
    update: { assignmentId: literaryAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000206',
      title: 'Literary Analysis Rubric',
      assignmentId: literaryAssignment.id,
      criteria: {
        create: [
          {
            description:
              'Thesis and argument — a clear claim about character development anchored throughout the essay.',
            maxPoints: 10,
          },
          {
            description:
              'Evidence and close reading — passages are quoted and analyzed in depth.',
            maxPoints: 15,
          },
          {
            description:
              'Structure and transitions — paragraphs build the argument coherently.',
            maxPoints: 10,
          },
          {
            description:
              'Language and conventions — precise vocabulary, correct grammar, MLA format.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000206' },
    data: { isConfirmed: true },
  });
  const literaryRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000206' },
    include: { criteria: true },
  });
  const literaryCriteria = literaryRubric.criteria;

  // ── Grade 11 Math — Trigonometry Problem Set ────────────────
  const trigAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000107' },
    update: { courseOfferingId: mathOffering11a.id },
    create: {
      id: '00000000-0000-0000-0000-000000000107',
      title: 'Trigonometry Problem Set 1',
      description:
        'Solve triangle problems using sine, cosine, and tangent; verify identities and sketch the unit circle.',
      dueDate: new Date('2026-09-10'),
      totalPoints: 40,
      courseOfferingId: mathOffering11a.id,
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000207' },
    update: { assignmentId: trigAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000207',
      title: 'Trigonometry Problem Set Rubric',
      assignmentId: trigAssignment.id,
      criteria: {
        create: [
          {
            description:
              'Setup and modeling — triangles and trigonometric relationships modeled correctly from word problems.',
            maxPoints: 10,
          },
          {
            description:
              'Computation and identities — correct computation of ratios, angles, and identity manipulations.',
            maxPoints: 15,
          },
          {
            description:
              'Graphical interpretation — unit circle angles and graphs sketched and labeled correctly.',
            maxPoints: 10,
          },
          {
            description:
              'Notation and clarity — steps shown with proper mathematical notation.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000207' },
    data: { isConfirmed: true },
  });
  const trigRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000207' },
    include: { criteria: true },
  });
  const trigCriteria = trigRubric.criteria;

  // ── Grade 11 Physics — Mechanics Problem Set ────────────────
  const mechanicsAssignment = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000108' },
    update: { courseOfferingId: physicsOffering11a.id },
    create: {
      id: '00000000-0000-0000-0000-000000000108',
      title: 'Mechanics Problem Set — Forces & Motion',
      description:
        'Solve force, acceleration, and energy problems on inclined planes and projectiles with full diagrams.',
      dueDate: new Date('2026-09-12'),
      totalPoints: 50,
      courseOfferingId: physicsOffering11a.id,
    },
  });

  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000208' },
    update: { assignmentId: mechanicsAssignment.id },
    create: {
      id: '00000000-0000-0000-0000-000000000208',
      title: 'Mechanics Problem Set Rubric',
      assignmentId: mechanicsAssignment.id,
      criteria: {
        create: [
          {
            description:
              'Free-body diagrams — forces are correctly isolated and drawn for each scenario.',
            maxPoints: 12,
          },
          {
            description:
              "Newton's laws application — correct equations, calculations, and units.",
            maxPoints: 20,
          },
          {
            description:
              'Energy and momentum — conservation applied correctly to each problem.',
            maxPoints: 12,
          },
          {
            description:
              'Communication — full solution steps and clear final answers.',
            maxPoints: 6,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000208' },
    data: { isConfirmed: true },
  });
  const mechanicsRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000208' },
    include: { criteria: true },
  });
  const mechanicsCriteria = mechanicsRubric.criteria;

  // ── Section 10B — its own assignments (sections can diverge) ──
  const essay10b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000109' },
    update: { courseOfferingId: englishOffering10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000109',
      title: 'Essay — Compare & Contrast',
      description:
        'Write a 500-800 word essay comparing two essays read in class, focusing on structure and argument.',
      dueDate: new Date('2026-09-08'),
      totalPoints: 40,
      courseOfferingId: englishOffering10b.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000209' },
    update: { assignmentId: essay10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000209',
      title: 'Compare & Contrast Rubric',
      assignmentId: essay10b.id,
      criteria: {
        create: [
          {
            description:
              'Thesis clarity and focus — the essay presents a clear, specific, and arguable thesis statement.',
            maxPoints: 10,
          },
          {
            description:
              'Quality of supporting evidence — arguments are supported with relevant, specific evidence and examples.',
            maxPoints: 15,
          },
          {
            description:
              'Organization and structure — ideas flow logically with clear introduction, body paragraphs, and conclusion.',
            maxPoints: 10,
          },
          {
            description:
              'Grammar and mechanics — writing is free of grammatical errors, with proper punctuation and spelling.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000209' },
    data: { isConfirmed: true },
  });
  const essay10bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000209' },
    include: { criteria: true },
  });
  const essay10bCriteria = essay10bRubric.criteria;

  const math10b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000110' },
    update: { courseOfferingId: mathOffering10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000110',
      title: 'Math Problem Set 2 — Quadratics',
      description:
        'Solve quadratic equations, sketch parabolas, and interpret the discriminant geometrically.',
      dueDate: new Date('2026-09-25'),
      totalPoints: 40,
      courseOfferingId: mathOffering10b.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000210' },
    update: { assignmentId: math10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000210',
      title: 'Problem Set 2 Rubric',
      assignmentId: math10b.id,
      criteria: {
        create: [
          {
            description:
              'Correct equation setup — systems are modeled correctly from word problems.',
            maxPoints: 10,
          },
          {
            description:
              'Solution accuracy — computations are correct with clear steps shown.',
            maxPoints: 15,
          },
          {
            description:
              'Geometric interpretation — solutions are correctly sketched on the coordinate plane.',
            maxPoints: 10,
          },
          {
            description:
              'Clarity and notation — work is legible with proper mathematical notation.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000210' },
    data: { isConfirmed: true },
  });
  const math10bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000210' },
    include: { criteria: true },
  });
  const math10bCriteria = math10bRubric.criteria;

  const lab10b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000111' },
    update: { courseOfferingId: scienceOffering10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000111',
      title: 'Science Lab Report — Photosynthesis',
      description:
        'Write a full lab report on a photosynthesis experiment following the standard scientific format.',
      dueDate: new Date('2026-10-01'),
      totalPoints: 60,
      courseOfferingId: scienceOffering10b.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000211' },
    update: { assignmentId: lab10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000211',
      title: 'Science Lab Report Rubric',
      assignmentId: lab10b.id,
      criteria: {
        create: [
          {
            description:
              'Abstract and introduction — provides clear context, hypothesis, and overview of the experiment.',
            maxPoints: 10,
          },
          {
            description:
              'Methods and materials — describes experimental procedure in sufficient detail for replication.',
            maxPoints: 15,
          },
          {
            description:
              'Results and data presentation — data is accurately presented using appropriate tables, graphs, and statistics.',
            maxPoints: 20,
          },
          {
            description:
              'Discussion and conclusion — interprets results, acknowledges limitations, and suggests future work.',
            maxPoints: 15,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000211' },
    data: { isConfirmed: true },
  });
  const lab10bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000211' },
    include: { criteria: true },
  });
  const lab10bCriteria = lab10bRubric.criteria;

  const history10b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000112' },
    update: { courseOfferingId: historyOffering.id },
    create: {
      id: '00000000-0000-0000-0000-000000000112',
      title: 'History Essay — Working with Primary Sources',
      description:
        'Submit a short essay analyzing a primary source from a historical event of your choice.',
      dueDate: new Date('2026-10-05'),
      totalPoints: 50,
      courseOfferingId: historyOffering.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000212' },
    update: { assignmentId: history10b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000212',
      title: 'Primary Sources Rubric',
      assignmentId: history10b.id,
      criteria: {
        create: [
          {
            description:
              'Research question — the proposal poses a focused, significant, and researchable historical question.',
            maxPoints: 15,
          },
          {
            description:
              'Source analysis — demonstrates ability to identify, evaluate, and compare primary and secondary sources.',
            maxPoints: 20,
          },
          {
            description:
              'Methodology — outlines a clear and appropriate approach for investigating the research question.',
            maxPoints: 10,
          },
          {
            description:
              'Writing quality — proposal is well-organized, clearly written, and properly cited.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000212' },
    data: { isConfirmed: true },
  });
  const history10bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000212' },
    include: { criteria: true },
  });
  const history10bCriteria = history10bRubric.criteria;

  // ── Section 11B — its own assignments ──────────────────────
  const literary11b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000113' },
    update: { courseOfferingId: englishOffering11b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000113',
      title: 'Literary Analysis — Symbolism',
      description:
        'Write a 600-800 word analysis of how symbolism shapes meaning in a novel read in class.',
      dueDate: new Date('2026-09-14'),
      totalPoints: 40,
      courseOfferingId: englishOffering11b.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000213' },
    update: { assignmentId: literary11b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000213',
      title: 'Symbolism Analysis Rubric',
      assignmentId: literary11b.id,
      criteria: {
        create: [
          {
            description:
              'Thesis and argument — a clear claim about character development anchored throughout the essay.',
            maxPoints: 10,
          },
          {
            description:
              'Evidence and close reading — passages are quoted and analyzed in depth.',
            maxPoints: 15,
          },
          {
            description:
              'Structure and transitions — paragraphs build the argument coherently.',
            maxPoints: 10,
          },
          {
            description:
              'Language and conventions — precise vocabulary, correct grammar, MLA format.',
            maxPoints: 5,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000213' },
    data: { isConfirmed: true },
  });
  const literary11bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000213' },
    include: { criteria: true },
  });
  const literary11bCriteria = literary11bRubric.criteria;

  const physics11b = await prisma.assignment.upsert({
    where: { id: '00000000-0000-0000-0000-000000000114' },
    update: { courseOfferingId: physicsOffering11.id },
    create: {
      id: '00000000-0000-0000-0000-000000000114',
      title: 'Physics Problem Set 2 — Energy & Momentum',
      description:
        'Solve energy and momentum conservation problems, including elastic and inelastic collisions.',
      dueDate: new Date('2026-09-18'),
      totalPoints: 50,
      courseOfferingId: physicsOffering11.id,
    },
  });
  await prisma.rubric.upsert({
    where: { id: '00000000-0000-0000-0000-000000000214' },
    update: { assignmentId: physics11b.id },
    create: {
      id: '00000000-0000-0000-0000-000000000214',
      title: 'Energy & Momentum Rubric',
      assignmentId: physics11b.id,
      criteria: {
        create: [
          {
            description:
              'Free-body diagrams — forces are correctly isolated and drawn for each scenario.',
            maxPoints: 12,
          },
          {
            description:
              "Newton's laws application — correct equations, calculations, and units.",
            maxPoints: 20,
          },
          {
            description:
              'Energy and momentum — conservation applied correctly to each problem.',
            maxPoints: 12,
          },
          {
            description:
              'Communication — full solution steps and clear final answers.',
            maxPoints: 6,
          },
        ],
      },
    },
  });
  await prisma.rubric.update({
    where: { id: '00000000-0000-0000-0000-000000000214' },
    data: { isConfirmed: true },
  });
  const physics11bRubric = await prisma.rubric.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000214' },
    include: { criteria: true },
  });
  const physics11bCriteria = physics11bRubric.criteria;

  console.log(
    `  Assignments + rubrics: ${poetryAssignment.title}, ${literaryAssignment.title}, ${trigAssignment.title}, ${mechanicsAssignment.title}`,
  );

  const seedSubmission = async (
    submissionId: string,
    assignmentId: string,
    studentId: string,
    pct: number,
    status: 'SUBMITTED' | 'CONFIRMED',
    createdAt: Date,
    criteria: Array<{ id: string; maxPoints: number }> = essayCriteria,
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
      data: criteria.map((c) => ({
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

  if (!FAST) {
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
      lab10b.id,
      secondStudent.id,
      45,
      'SUBMITTED',
      new Date('2026-07-20'),
      lab10bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000305',
      essay10b.id,
      secondStudent.id,
      80,
      'CONFIRMED',
      new Date('2026-07-02'),
      essay10bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000306',
      history10b.id,
      secondStudent.id,
      77,
      'CONFIRMED',
      new Date('2026-07-12'),
      history10bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000307',
      mathAssignment.id,
      chris.id,
      78,
      'CONFIRMED',
      new Date('2026-08-20'),
      mathCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000308',
      mathAssignment.id,
      liam.id,
      52,
      'SUBMITTED',
      new Date('2026-08-24'),
      mathCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000309',
      lab10b.id,
      sara.id,
      82,
      'CONFIRMED',
      new Date('2026-07-18'),
      lab10bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000310',
      math10b.id,
      sara.id,
      75,
      'CONFIRMED',
      new Date('2026-08-21'),
      math10bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000311',
      essayAssignment.id,
      omar.id,
      68,
      'CONFIRMED',
      new Date('2026-06-25'),
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000312',
      researchAssignment.id,
      omar.id,
      71,
      'CONFIRMED',
      new Date('2026-07-08'),
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000313',
      literary11b.id,
      ethan.id,
      85,
      'CONFIRMED',
      new Date('2026-08-02'),
      literary11bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000314',
      physics11b.id,
      ethan.id,
      78,
      'CONFIRMED',
      new Date('2026-08-06'),
      physics11bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000315',
      trigAssignment.id,
      liam.id,
      60,
      'CONFIRMED',
      new Date('2026-08-05'),
      trigCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000316',
      literaryAssignment.id,
      liam.id,
      66,
      'CONFIRMED',
      new Date('2026-08-07'),
      literaryCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000317',
      trigAssignment.id,
      ava.id,
      88,
      'CONFIRMED',
      new Date('2026-08-03'),
      trigCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000318',
      literaryAssignment.id,
      ava.id,
      84,
      'CONFIRMED',
      new Date('2026-08-04'),
      literaryCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000319',
      physics11b.id,
      noor.id,
      76,
      'CONFIRMED',
      new Date('2026-08-08'),
      physics11bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000320',
      literary11b.id,
      noor.id,
      70,
      'CONFIRMED',
      new Date('2026-08-09'),
      literary11bCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000321',
      literaryAssignment.id,
      zoe.id,
      81,
      'CONFIRMED',
      new Date('2026-08-10'),
      literaryCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000322',
      mechanicsAssignment.id,
      zoe.id,
      73,
      'CONFIRMED',
      new Date('2026-08-11'),
      mechanicsCriteria,
    );
    await seedSubmission(
      '00000000-0000-0000-0000-000000000323',
      poetryAssignment.id,
      student.id,
      48,
      'SUBMITTED',
      new Date('2026-08-28'),
      poetryCriteria,
    );
  } // end if (!FAST) — submission fixtures skipped in fast mode

  console.log(
    '  Demo grades seeded: Sam (essay 29%, research 72%, lab 57%), Maya (essay 80%, research 77%, lab 45% pending)',
  );
  console.log(
    '  Math submissions: Chris (78% confirmed), Liam (52% pending review)',
  );
  console.log(
    '  Class submissions: Sara, Omar (G10), Ethan, Liam, Ava, Noor, Zoe (G11) all confirmed ≥60%',
  );
  console.log(
    '  Sam poetry (SUBMITTED 48%, unconfirmed) — confirm in teacher console to trigger the communication agent',
  );

  const allOfferings: Array<{
    id: string;
    createdAt: Date;
    teacherId: string;
  }> = [
    { ...englishOffering, teacherId: teacher.id },
    { ...historyOffering10a, teacherId: raj.id },
    { ...scienceOffering10a, teacherId: dana.id },
    { ...mathOffering, teacherId: dana.id },
    { ...englishOffering10b, teacherId: teacher.id },
    { ...historyOffering, teacherId: raj.id },
    { ...scienceOffering10b, teacherId: dana.id },
    { ...mathOffering10b, teacherId: dana.id },
    { ...englishOffering11, teacherId: teacher.id },
    { ...mathOffering11a, teacherId: dana.id },
    { ...physicsOffering11a, teacherId: raj.id },
    { ...englishOffering11b, teacherId: teacher.id },
    { ...mathOffering11, teacherId: dana.id },
    { ...physicsOffering11, teacherId: raj.id },
  ];

  await prisma.classTeacherLog.deleteMany({
    where: { courseOfferingId: { in: allOfferings.map((o) => o.id) } },
  });
  await prisma.classTeacherLog.createMany({
    data: allOfferings.map((offering) => ({
      courseOfferingId: offering.id,
      teacherId: offering.teacherId,
      startedAt: offering.createdAt,
    })),
  });
  console.log(
    `  Teachers assigned to ${allOfferings.length} course offerings (Alex: English 10/11, Dana: Math 10/11 + Science, Raj: History 10 + Physics 11)`,
  );

  const newAuthAccounts: Array<{ email: string; name: string }> = [
    dana,
    raj,
    chris,
    sara,
    omar,
    ethan,
    liam,
    ava,
    noor,
    zoe,
    linda,
    hana,
  ];

  // WP6: batch all Supabase createAuthUser calls (chunked at 10).
  const allAuthAccounts: Array<{ email: string; name: string }> = [
    { email: 'admin@eduai.test', name: 'Admin User' },
    { email: 'teacher@eduai.test', name: 'Alex Mentor' },
    { email: 'student@eduai.test', name: 'Sam Learner' },
    { email: 'maya@eduai.test', name: 'Maya Chen' },
    { email: 'guardian@eduai.test', name: 'Guardian User' },
    ...newAuthAccounts,
  ];
  const authIds = await runBatched(
    allAuthAccounts.map(
      (account) => () =>
        createAuthUser(account.email, 'password123', account.name),
    ),
    10,
  );
  await Promise.all(
    allAuthAccounts.flatMap((account, index) => {
      const authId = authIds[index];
      return authId
        ? [
            prisma.user.update({
              where: { email: account.email },
              data: { authId },
            }),
          ]
        : [];
    }),
  );
  console.log(
    `  Auth accounts created for ${allAuthAccounts.length} users (password123)`,
  );

  await seedArabicTranscriptFixture(organization.id);
  await seedProjectileMaterial();

  console.log('\n✅ Seed complete! IDs for Swagger testing:');
  console.log(`  Admin ID:         ${adminUser.id}`);
  console.log(`  Student ID:       ${student.id}`);
  console.log(`  Student 2 ID:     ${secondStudent.id}`);
  console.log(`  Section A/B (G10):   ${sec10a.id} / ${sec10b.id}`);
  console.log(`  Section A/B (G11):   ${sec11a.id} / ${sec11b.id}`);
  console.log(`  Assignment (Essay):      ${essayAssignment.id}`);
  console.log(`  Assignment (Research):   ${researchAssignment.id}`);
  console.log(`  Assignment (Lab):        ${labAssignment.id}`);
  console.log(`  Rubric (Essay):         00000000-0000-0000-0000-000000000201`);
  console.log(`  Rubric (Research):      00000000-0000-0000-0000-000000000202`);
  console.log(`  Rubric (Lab):           00000000-0000-0000-0000-000000000203`);
  console.log('  Submissions:');
  console.log(
    '    Sam:  301 essay (CONFIRMED 29), 302 research (CONFIRMED 72), 303 lab (CONFIRMED 57)',
  );
  console.log(
    '    Maya: 305 essay (CONFIRMED 80), 306 research (CONFIRMED 77), 304 lab (SUBMITTED 45 — confirm me)',
  );
  console.log(
    '    Chris: 307 math problem set (CONFIRMED 31), Liam: 308 math problem set (SUBMITTED — confirm me)',
  );
  console.log(
    '    Sara: 309 lab (82), 310 math (75); Omar: 311 essay (68), 312 research (71)',
  );
  console.log(
    '    G11 confirmed: Ethan 313/314, Liam 315/316, Ava 317/318, Noor 319/320, Zoe 321/322',
  );
  console.log(
    '    Sam:  323 poetry (SUBMITTED 48 — confirm to trigger communication agent + practice)',
  );
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
