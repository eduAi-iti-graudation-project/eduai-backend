import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { SubscriptionGuard } from './auth/subscription.guard';
import { GuardianRequirementGuard } from './auth/guardian-requirement.guard';
import { GradeLevelsModule } from './grade-levels/grade-levels.module';
import { SectionsModule } from './sections/sections.module';
import { RosterModule } from './roster/roster.module';
import { CoursesModule } from './courses/courses.module';
import { OfferingsModule } from './offerings/offerings.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { RubricsModule } from './rubrics/rubrics.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { GradingModule } from './grading/grading.module';
import { AlertsModule } from './alerts/alerts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { AssistantModule } from './assistant/assistant.module';
import { MaterialsModule } from './materials/materials.module';
import { StudentsModule } from './students/students.module';
import { LlmModule } from './common/llm/llm.module';
import { PiiModule } from './common/pii/pii.module';
import { ValidationModule } from './common/validation/validation.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';

import { TeachersModule } from './teachers/teachers.module';
import { UsersModule } from './users/users.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { FeedbackWriterModule } from './feedback-writer/feedback-writer.module';
import { HomeworkHelperModule } from './homework-helper/homework-helper.module';
import { StudyLabModule } from './study-lab/study-lab.module';
import { ChatModule } from './chat/chat.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { BillingModule } from './billing/billing.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { GroupsModule } from './groups/groups.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { DocumentsModule } from './documents/documents.module';
import { TimetableModule } from './timetable/timetable.module';
import { MeetingsModule } from './meetings/meetings.module';
import { StruggleSignalsModule } from './struggle-signals/struggle-signals.module';
import { LabsModule } from './labs/labs.module';
import { MigrationModule } from './migration/migration.module';
import { JoinRequestsModule } from './join-requests/join-requests.module';
import { GuardianModule } from './guardian/guardian.module';
import { ClassesModule } from './classes/classes.module';
import { GradeConsoleModule } from './grade-console/grade-console.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    GradeLevelsModule,
    SectionsModule,
    CoursesModule,
    OfferingsModule,
    AssignmentsModule,
    RubricsModule,
    SubmissionsModule,
    GradingModule,
    AlertsModule,
    NotificationsModule,
    ReportsModule,
    AssistantModule,
    MaterialsModule,
    StudentsModule,
    LlmModule,
    PiiModule,
    ValidationModule,
    AttendanceModule,
    DashboardModule,
    GradeLevelsModule,
    RosterModule,
    SectionsModule,
    CoursesModule,
    OfferingsModule,
    TeachersModule,
    UsersModule,
    QuizzesModule,
    FeedbackWriterModule,
    HomeworkHelperModule,
    StudyLabModule,
    ChatModule,
    BroadcastsModule,
    BillingModule,
    WebhooksModule,
    GroupsModule,
    OrganizationsModule,
    DocumentsModule,
    TimetableModule,
    MeetingsModule,
    StruggleSignalsModule,
    MigrationModule,
    JoinRequestsModule,
    GuardianModule,
    ClassesModule,
    GradeConsoleModule,
    LabsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: GuardianRequirementGuard },
  ],
})
export class AppModule {}
