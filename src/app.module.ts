import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { ClassesModule } from './classes/classes.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { RubricsModule } from './rubrics/rubrics.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { GradingModule } from './grading/grading.module';
import { AlertsModule } from './alerts/alerts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AssistantModule } from './assistant/assistant.module';
import { MaterialsModule } from './materials/materials.module';
import { StudentsModule } from './students/students.module';
import { LlmModule } from './common/llm/llm.module';
import { PiiModule } from './common/pii/pii.module';
import { ValidationModule } from './common/validation/validation.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GradesModule } from './grades/grades.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { TeachersModule } from './teachers/teachers.module';
import { UsersModule } from './users/users.module';
import { FeedbackWriterModule } from './feedback-writer/feedback-writer.module';
import { HomeworkHelperModule } from './homework-helper/homework-helper.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ClassesModule,
    AssignmentsModule,
    RubricsModule,
    SubmissionsModule,
    GradingModule,
    AlertsModule,
    NotificationsModule,
    ReportsModule,
    AnalysisModule,
    AssistantModule,
    MaterialsModule,
    StudentsModule,
    LlmModule,
    PiiModule,
    ValidationModule,
    AttendanceModule,
    DashboardModule,
    GradesModule,
    EnrollmentsModule,
    TeachersModule,
    UsersModule,
    FeedbackWriterModule,
    HomeworkHelperModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
