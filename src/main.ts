import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('EduAI API')
    .setDescription('EduAI — AI-assisted grading platform')
    .setVersion('0.1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, cleanupOpenApiDoc(document));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err) => {
  console.error('FATAL: Server failed to start', err);
  process.exit(1);
});
