import { Injectable, Logger, NotFoundException } from '@nestjs/common';                                       
import { PrismaService } from '../prisma/prisma.service';                                                     
import { FeedbackWriterService } from '../feedback-writer/feedback-writer.service';                           
import { CommunicationAgentService } from '../communication-agent/communication-agent.service';               

@Injectable()                                                                                                 
export class GradingService {                                                                                 
  private readonly logger = new Logger(GradingService.name);                                                  

  constructor(                                                                                                
    private readonly prisma: PrismaService,                                                                   
    private readonly feedbackWriterService: FeedbackWriterService,                                            
    private readonly communicationAgentService: CommunicationAgentService,                                    
  ) {}                                                                                                        

  async gradeSubmission(submissionId: string): Promise<void> {                                                
    await this.prisma.submission.update({                                                                     
      where: { id: submissionId },                                                                            
      data: { status: 'GRADING_IN_PROGRESS' },                                                                
    });                                                                                                       

    const criteria = await this.prisma.rubricCriteria.findMany({                                              
      where: {                                                                                                
        rubric: { assignment: { submissions: { some: { id: submissionId } } } },                              
      },                                                                                                      
    });                                                                                                       

    for (const criterion of criteria) {                                                                       
      await this.prisma.gradingScore.upsert({                                                                 
        where: {                                                                                              
          submissionId_criteriaId: { submissionId, criteriaId: criterion.id },                                
        },                                                                                                    
        create: {                                                                                             
          submissionId,                                                                                       
          criteriaId: criterion.id,                                                                           
          pointsAwarded: Math.floor(criterion.maxPoints * 0.7),                                               
          aiFeedback: null,                                                                                   
        },                                                                                                    
        update: {},                                                                                           
      });                                                                                                     
    }                                                                                                         

    await this.prisma.submission.update({                                                                     
      where: { id: submissionId },                                                                            
      data: { status: 'REVIEW_READY' },                                                                       
    });                                                                                                       
  }                                                                                                           

  async confirmAll(submissionId: string) {                                                                    
    const submission = await this.prisma.submission.findUnique({                                              
      where: { id: submissionId },                                                                            
      include: { scores: true },                                                                              
    });                                                                                                       
    if (!submission) throw new NotFoundException('Submission not found');                                     

    await this.prisma.$transaction(async (tx) => {                                                            
      await tx.gradingScore.updateMany({                                                                      
        where: { submissionId, isConfirmed: false },                                                          
        data: { isConfirmed: true },                                                                          
      });                                                                                                     
      await tx.submission.update({                                                                            
        where: { id: submissionId },                                                                          
        data: { status: 'CONFIRMED' },                                                                        
      });                                                                                                     
    });                                                                                                       

    // Fire off the Feedback Writer Agent                                                                     
    this.feedbackWriterService                                                                                
      .write(submissionId)                                                                                    
      .then(() =>                                                                                             
        this.logger.log(`Feedback written for submission ${submissionId}`),                                   
      )                                                                                                       
      .catch((err) =>                                                                                         
        this.logger.error(`Feedback writing failed for ${submissionId}`, err),                                
      );                                                                                                      

    // Fire off the Communication Agent                                                                       
    this.communicationAgentService                                                                            
      .analyze(submissionId)                                                                                  
      .then(() =>                                                                                             
        this.logger.log(                                                                                      
          `Communication agent analysis complete for submission ${submissionId}`,                             
        ),                                                                                                    
      )                                                                                                       
      .catch((err) =>                                                                                         
        this.logger.error(                                                                                    
          `Communication agent analysis failed for submission ${submissionId}`,                               
          err,                                                                                                
        ),                                                                                                    
      );                                                                                                      

    return this.prisma.submission.findUnique({                                                                
      where: { id: submissionId },                                                                            
      include: { scores: true },                                                                              
    });                                                                                                       
  }                                                                                                           

  async getScores(submissionId: string) {                                                                     
    const submission = await this.prisma.submission.findUnique({                                              
      where: { id: submissionId },                                                                            
    });                                                                                                       
    if (!submission) throw new NotFoundException('Submission not found');                                     

    return this.prisma.gradingScore.findMany({                                                                
      where: { submissionId },                                                                                
      include: { criteria: true },                                                                            
    });                                                                                                       
  }                                                                                                           

  async backfillFeedback() {                                                                                  
    const scores = await this.prisma.gradingScore.findMany({                                                  
      where: { isConfirmed: true, aiFeedback: null },                                                         
      select: { submissionId: true },                                                                         
    });                                                                                                       

    const submissionIds = [...new Set(scores.map((s) => s.submissionId))];                                    

    if (submissionIds.length === 0) {                                                                         
      return { submissionsProcessed: 0, scoresBackfilled: 0 };                                                
    }                                                                                                         

    let totalScores = 0;                                                                                      
    await Promise.allSettled(                                                                                 
      submissionIds.map((id) =>                                                                               
        this.feedbackWriterService                                                                            
          .write(id)                                                                                          
          .then(() => {                                                                                       
            totalScores += scores.filter((s) => s.submissionId === id).length;                                
            this.logger.log(`Backfill feedback written for submission ${id}`);                                
          })                                                                                                  
          .catch((err) =>                                                                                     
            this.logger.error(`Backfill feedback failed for ${id}`, err),                                     
          ),                                                                                                  
      ),                                                                                                      
    );                                                                                                        

    return {
      submissionsProcessed: submissionIds.length,
      scoresBackfilled: totalScores,
    };
  }

  async updateScore(scoreId: string, pointsAwarded: number) {
    const score = await this.prisma.gradingScore.findUnique({
      where: { id: scoreId },
    });
    if (!score) throw new NotFoundException('Score not found');
    if (score.isConfirmed) {
      throw new Error('Cannot edit a confirmed score');
    }

    return this.prisma.gradingScore.update({
      where: { id: scoreId },
      data: { pointsAwarded },
      include: { criteria: true },
    });
  }
}

