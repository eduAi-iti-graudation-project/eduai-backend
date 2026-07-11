import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ClassesModule } from './classes/classes.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { RubricsModule } from './rubrics/rubrics.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { GradingModule } from './grading/grading.module';
import { AlertsModule } from './alerts/alerts.module';
import { AssistantModule } from './assistant/assistant.module';
import { StudentsModule } from './students/students.module';
import { LlmModule } from './common/llm/llm.module';
import { PiiModule } from './common/pii/pii.module';
import { ValidationModule } from './common/validation/validation.module';

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
    AssistantModule,
    StudentsModule,
    LlmModule,
    PiiModule,
    ValidationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
