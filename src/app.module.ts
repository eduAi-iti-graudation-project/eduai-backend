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
import { GradeLevelsModule } from './grade-levels/grade-levels.module';
import { SectionsModule } from './sections/sections.module';
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
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { TeachersModule } from './teachers/teachers.module';
import { UsersModule } from './users/users.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { FeedbackWriterModule } from './feedback-writer/feedback-writer.module';
import { HomeworkHelperModule } from './homework-helper/homework-helper.module';
import { ChatModule } from './chat/chat.module';
import { BillingModule } from './billing/billing.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OrganizationsModule } from './organizations/organizations.module';

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
    SectionsModule,
    CoursesModule,
    OfferingsModule,
    EnrollmentsModule,
    TeachersModule,
    UsersModule,
    QuizzesModule,
    FeedbackWriterModule,
    HomeworkHelperModule,
    ChatModule,
    BillingModule,
    WebhooksModule,
    OrganizationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule {}
