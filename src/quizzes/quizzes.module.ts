import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [MaterialsModule],
  controllers: [QuizzesController],
  providers: [QuizzesService, QuizzesGradingService, QuizGenerationAgent],
  exports: [QuizzesService, QuizzesGradingService],
})
export class QuizzesModule {}
