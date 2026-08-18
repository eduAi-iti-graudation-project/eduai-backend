import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiConsumes, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MeetingsService } from './meetings.service';
import { Roles } from '../auth/roles.decorator';
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';
import {
  CreateMeetingDto,
  MeetingDetailDto,
  MeetingListDto,
  JoinMeetingDto,
  UpdateRecordingDto,
  RecordingResponseDto,
  SendChatMessageDto,
  ChatHistoryResponseDto,
  ChatMessageResponseDto,
  TranscriptResponseDto,
  SaveTranscriptDto,
} from './dto';

@ApiTags('meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  // Creation is guard-level restricted: TEACHER + ADMIN only.
  // STUDENT and GUARDIAN never reach the service.
  @Roles('TEACHER', 'ADMIN')
  @Post()
  @ApiOperation({
    summary:
      'Schedule a one-off meeting. TEACHER: CLASS meeting for an offering they teach. ADMIN: AD_HOC meeting with an explicit participant list.',
  })
  async create(
    @Body() dto: CreateMeetingDto,
    @CurrentUser() user: User,
  ): Promise<MeetingDetailDto> {
    return this.meetingsService.create(user, dto);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Get()
  @AllowGuardianless()
  @ApiOperation({ summary: 'List meetings the caller is allowed to see' })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['upcoming', 'past', 'all'],
  })
  async list(
    @CurrentUser() user: User,
    @Query('scope') scope?: 'upcoming' | 'past' | 'all',
  ): Promise<MeetingListDto> {
    return this.meetingsService.list(user, scope ?? 'all');
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Get(':id')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Get a meeting with participants and attendance' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<MeetingDetailDto> {
    return this.meetingsService.findOne(user, id);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Post(':id/join')
  @ApiOperation({
    summary:
      'Get a short-lived LiveKit access token. Only permitted for users allowed in the room; records attendance.',
  })
  async join(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<JoinMeetingDto> {
    return this.meetingsService.join(user, id);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Post(':id/leave')
  @ApiOperation({ summary: "Mark the caller's attendance row as left" })
  async leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.meetingsService.leave(user, id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/end')
  @ApiOperation({ summary: 'End a meeting (host only)' })
  async end(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<MeetingDetailDto> {
    return this.meetingsService.end(user, id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/recording')
  @ApiOperation({
    summary:
      'Toggle recording for a meeting (host only). When enabled, every participant sees a persistent recording indicator.',
  })
  async setRecording(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecordingDto,
    @CurrentUser() user: User,
  ): Promise<MeetingDetailDto> {
    return this.meetingsService.setRecording(user, id, dto.enabled);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Get(':id/recording')
  @AllowGuardianless()
  @ApiOperation({
    summary:
      "Get a past meeting's recording URL. Gated by the same permission as joining the live meeting.",
  })
  async recording(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<RecordingResponseDto> {
    return this.meetingsService.getRecording(user, id);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post(':id/recording/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload a recording video file for a meeting (host only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadRecording(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<MeetingDetailDto> {
    return this.meetingsService.uploadRecording(
      user,
      id,
      file.buffer,
      file.originalname,
    );
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Get(':id/messages')
  @AllowGuardianless()
  @ApiOperation({ summary: 'In-meeting chat history (newest first, paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<ChatHistoryResponseDto> {
    return this.meetingsService.listMessages(
      user,
      id,
      cursor,
      Math.min(Math.max(limit, 1), 200),
    );
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send an in-meeting chat message (broadcast over socket.io)',
  })
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendChatMessageDto,
    @CurrentUser() user: User,
  ): Promise<ChatMessageResponseDto> {
    return this.meetingsService.sendMessage(user, id, dto.text);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Get(':id/transcript')
  @AllowGuardianless()
  @ApiOperation({
    summary:
      'Meeting transcript (timestamped segments) once the recording has been transcribed.',
  })
  async transcript(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<TranscriptResponseDto> {
    return this.meetingsService.getTranscript(user, id);
  }

  @Roles('TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN')
  @Post(':id/transcript')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Save live transcript segments captured during the call' })
  async saveTranscript(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveTranscriptDto,
    @CurrentUser() user: User,
  ) {
    return this.meetingsService.saveLiveTranscript(
      user,
      id,
      dto.segments ?? [],
      dto.replace ?? false,
    );
  }
}
