import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequiresTier } from '../auth/requires-tier.decorator';
import { Roles } from '../auth/roles.decorator';
import { ApiError } from '../common/errors/api-error';
import {
  GenerateLabDto,
  LabDto,
  RefineLabDto,
  RejectLabDto,
  type LabGenerationEvent,
} from './dto';
import { LabsService } from './labs.service';

@ApiTags('labs')
@Controller('labs')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Post('generate')
  @Roles('TEACHER')
  @RequiresTier('PRO', 'ENTERPRISE')
  @ApiOperation({
    summary:
      'Generate a lab (SSE: step events then a done event). Default mode builds a template game spec via the lab architect agent; mode "advanced" runs free-form generation of any self-contained interactive game code, checked by deterministic plain-code guards.',
  })
  async generate(
    @Body() dto: GenerateLabDto,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: LabGenerationEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const result = await this.labsService.generate(user, dto, (step) =>
        send({ type: 'step', step }),
      );
      send({ type: 'done', data: result });
      res.end();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      send({ type: 'error', message });
      res.end();
    }
  }

  @Post(':id/refine')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Iteratively refine a lab (SSE: step events then a done event). Template labs get their game spec modified in place; legacy labs get their code modified and re-reviewed. Never regenerates from scratch.',
  })
  async refine(
    @Param('id') id: string,
    @Body() dto: RefineLabDto,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: LabGenerationEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const result = await this.labsService.refine(
        user,
        id,
        dto.instruction,
        (step) => send({ type: 'step', step }),
      );
      send({ type: 'done', data: result });
      res.end();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      send({ type: 'error', message });
      res.end();
    }
  }

  @Post(':id/regenerate')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Restart a lab from scratch (SSE: step events then a done event). Replaces the current content with a fresh generation grounded in the same unit — use this instead of refine when the lab is beyond repair.',
  })
  async regenerate(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: LabGenerationEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const result = await this.labsService.regenerate(user, id, (step) =>
        send({ type: 'step', step }),
      );
      send({ type: 'done', data: result });
      res.end();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.';
      send({ type: 'error', message });
      res.end();
    }
  }

  @Post(':id/publish')
  @Roles('TEACHER')
  @ApiOperation({
    summary: 'Publish a lab. Only allowed from PENDING_TEACHER_REVIEW.',
  })
  @ApiOkResponse({ type: LabDto })
  publish(@Param('id') id: string, @CurrentUser() user: User) {
    return this.labsService.publish(user, id);
  }

  @Post(':id/reject')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Reject a lab that has not reached a final status, with optional notes.',
  })
  @ApiOkResponse({ type: LabDto })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectLabDto,
    @CurrentUser() user: User,
  ) {
    return this.labsService.reject(user, id, dto.notes);
  }

  @Delete(':id')
  @Roles('TEACHER')
  @ApiOperation({
    summary:
      'Hard-delete a lab the teacher owns. Any status — deleting a published lab removes student access. Removes the lab and its offering links.',
  })
  @ApiOkResponse({ type: LabDto })
  delete(@Param('id') id: string, @CurrentUser() user: User) {
    return this.labsService.delete(user, id);
  }

  @Get()
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({
    summary:
      'List labs. Teachers see their own labs (optionally filtered by course offering); students only ever see PUBLISHED labs in their enrolled offerings.',
  })
  @ApiOkResponse({ type: LabDto, isArray: true })
  list(
    @Query('courseOfferingId') courseOfferingId: string | undefined,
    @CurrentUser() user: User,
  ) {
    return this.labsService.listForUser(user, courseOfferingId);
  }

  @Get(':id')
  @Roles('TEACHER', 'STUDENT')
  @ApiOperation({
    summary:
      'Get one lab. Students can only retrieve PUBLISHED labs — a direct URL to a pending or rejected lab returns 404.',
  })
  @ApiOkResponse({ type: LabDto })
  get(@Param('id') id: string, @CurrentUser() user: User) {
    return this.labsService.getForUser(user, id);
  }
}
