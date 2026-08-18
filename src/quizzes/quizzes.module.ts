import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizViolationsService } from './quiz-violations.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { AiModule } from '../common/ai/ai.module';

@Module({
  imports: [MaterialsModule, NotificationsModule, ReportsModule, AiModule],
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
