import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizViolationsService } from './quiz-violations.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { MaterialsModule } from '../materials/materials.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [MaterialsModule, NotificationsModule, ReportsModule],
  controllers: [QuizzesController],
  providers: [
    QuizzesService,
    QuizzesGradingService,
    QuizViolationsService,
    QuizGenerationAgent,
  ],
  exports: [QuizzesService, QuizzesGradingService],
})
export class QuizzesModule {}
