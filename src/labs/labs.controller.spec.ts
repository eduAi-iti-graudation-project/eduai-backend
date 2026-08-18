import type { Response } from 'express';
import type { User } from '@prisma/client';
import { LabsController } from './labs.controller';
import { LabsService } from './labs.service';
import type { GenerateLabDto } from './dto';

const mockGenerate = jest.fn();
const mockRefine = jest.fn();
const mockRegenerate = jest.fn();
const mockDelete = jest.fn();
const mockDeleteMany = jest.fn();

const teacher = {
  id: 'teacher-0001',
  organizationId: 'org-0001',
  role: 'TEACHER',
} as unknown as User;

interface MockResponse {
  res: Response;
  setHeader: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
}

function mockResponse(): MockResponse {
  const setHeader = jest.fn();
  const flushHeaders = jest.fn();
  const write = jest.fn();
  const end = jest.fn();
  return {
    res: { setHeader, flushHeaders, write, end } as unknown as Response,
    setHeader,
    write,
    end,
  };
}

function writtenEvents(write: jest.Mock): unknown[] {
  return write.mock.calls.map(
    ([chunk]: string[]) => JSON.parse(String(chunk).slice(5).trim()) as unknown,
  );
}

describe('LabsController (SSE)', () => {
  let controller: LabsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LabsController({
      generate: mockGenerate,
      refine: mockRefine,
      regenerate: mockRegenerate,
      delete: mockDelete,
      deleteMany: mockDeleteMany,
    } as unknown as LabsService);
  });

  it('POST /labs/generate streams step events then a done event', async () => {
    mockGenerate.mockImplementation(
      (_user: User, _dto: GenerateLabDto, onStep?: (step: string) => void) => {
        onStep?.('thinking');
        onStep?.('search_curriculum');
        onStep?.('generate_code');
        return {
          grounded: true,
          labId: 'lab-0001',
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        };
      },
    );

    const { res, setHeader, write, end } = mockResponse();
    await controller.generate(
      {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
      },
      teacher,
      res,
    );

    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream; charset=utf-8',
    );
    expect(writtenEvents(write)).toEqual([
      { type: 'step', step: 'thinking' },
      { type: 'step', step: 'search_curriculum' },
      { type: 'step', step: 'generate_code' },
      {
        type: 'done',
        data: {
          grounded: true,
          labId: 'lab-0001',
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        },
      },
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('POST /labs/generate sends an error event when the pipeline throws', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));

    const { res, write, end } = mockResponse();
    await controller.generate(
      {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
      },
      teacher,
      res,
    );

    expect(writtenEvents(write)).toEqual([
      { type: 'error', message: 'Something went wrong. Please try again.' },
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('POST /labs/:id/refine streams the modify-in-place steps then a done event', async () => {
    mockRefine.mockImplementation(
      (
        _user: User,
        _id: string,
        _instruction: string,
        onStep?: (step: string) => void,
      ) => {
        onStep?.('thinking');
        onStep?.('load_lab');
        onStep?.('modify_lab');
        return {
          grounded: true,
          labId: 'lab-0001',
          status: 'AI_REVIEW_FAILED',
          message: null,
          reviewApproved: false,
          reviewFlags: { flags: ['missing render target'], reasoning: 'x' },
        };
      },
    );

    const { res, write, end } = mockResponse();
    await controller.refine(
      'lab-0001',
      { instruction: 'make the angle adjustable' },
      teacher,
      res,
    );

    expect(writtenEvents(write)).toEqual([
      { type: 'step', step: 'thinking' },
      { type: 'step', step: 'load_lab' },
      { type: 'step', step: 'modify_lab' },
      {
        type: 'done',
        data: {
          grounded: true,
          labId: 'lab-0001',
          status: 'AI_REVIEW_FAILED',
          message: null,
          reviewApproved: false,
          reviewFlags: {
            flags: ['missing render target'],
            reasoning: 'x',
          },
        },
      },
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('POST /labs/:id/regenerate streams the restart steps then a done event', async () => {
    mockRegenerate.mockImplementation(
      (_user: User, _id: string, onStep?: (step: string) => void) => {
        onStep?.('thinking');
        onStep?.('search_curriculum');
        onStep?.('design_game');
        return {
          grounded: true,
          labId: 'lab-0001',
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        };
      },
    );

    const { res, write, end } = mockResponse();
    await controller.regenerate('lab-0001', teacher, res);

    expect(writtenEvents(write)).toEqual([
      { type: 'step', step: 'thinking' },
      { type: 'step', step: 'search_curriculum' },
      { type: 'step', step: 'design_game' },
      {
        type: 'done',
        data: {
          grounded: true,
          labId: 'lab-0001',
          status: 'PENDING_TEACHER_REVIEW',
          message: null,
          reviewApproved: null,
          reviewFlags: null,
        },
      },
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('POST /labs/:id/regenerate sends an error event when the lab cannot be restarted', async () => {
    mockRegenerate.mockRejectedValue(new Error('boom'));

    const { res, write, end } = mockResponse();
    await controller.regenerate('lab-0001', teacher, res);

    expect(writtenEvents(write)).toEqual([
      { type: 'error', message: 'Something went wrong. Please try again.' },
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('DELETE /labs/:id delegates to the service and returns the deleted lab', async () => {
    mockDelete.mockResolvedValue({ id: 'lab-0001' });

    const result = await controller.delete('lab-0001', teacher);

    expect(mockDelete).toHaveBeenCalledWith(teacher, 'lab-0001');
    expect(result).toEqual({ id: 'lab-0001' });
  });

  it('DELETE /labs/bulk delegates to the service and returns the deleted count', async () => {
    mockDeleteMany.mockResolvedValue({ deleted: 2 });

    const result = await controller.deleteMany(
      { ids: ['lab-0001', 'lab-0002'] },
      teacher,
    );

    expect(mockDeleteMany).toHaveBeenCalledWith(teacher, [
      'lab-0001',
      'lab-0002',
    ]);
    expect(result).toEqual({ deleted: 2 });
  });
});
