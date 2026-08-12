import { LivekitService } from './livekit.service';

const ENV_KEYS = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'SUPABASE_STORAGE_S3_ACCESS_KEY',
  'SUPABASE_STORAGE_S3_SECRET_KEY',
  'SUPABASE_STORAGE_S3_ENDPOINT',
  'SUPABASE_MEETINGS_BUCKET',
] as const;

describe('LivekitService', () => {
  let service: LivekitService;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    service = new LivekitService();
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const realConfig = () => {
    process.env.LIVEKIT_URL = 'wss://eduai-dczlzhyd.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'APIMyNhRtYFFSAV';
    process.env.LIVEKIT_API_SECRET = 'a-real-looking-api-secret-0123456789';
  };

  describe('isConfigured', () => {
    it('is false when all credentials are missing', () => {
      expect(service.isConfigured()).toBe(false);
    });

    it('is false when credentials are the dev placeholders', () => {
      process.env.LIVEKIT_URL = 'wss://dev.example.livekit.cloud';
      process.env.LIVEKIT_API_KEY = 'devkey';
      process.env.LIVEKIT_API_SECRET = 'devsecret_at_least_16_chars_for_dev';
      expect(service.isConfigured()).toBe(false);
    });

    it('is false when only some values are placeholders', () => {
      process.env.LIVEKIT_URL = 'wss://eduai-dczlzhyd.livekit.cloud';
      process.env.LIVEKIT_API_KEY = 'APIMyNhAPuFFSAV';
      process.env.LIVEKIT_API_SECRET = 'devsecret_at_least_16_chars_for_dev';
      expect(service.isConfigured()).toBe(false);
    });

    it('is true for real-looking credentials', () => {
      realConfig();
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('isStorageConfigured', () => {
    it('is false when S3 storage vars are missing', () => {
      realConfig();
      expect(service.isStorageConfigured()).toBe(false);
    });

    it('is true only when the complete S3 block is present', () => {
      realConfig();
      process.env.SUPABASE_STORAGE_S3_ACCESS_KEY = 'ak';
      process.env.SUPABASE_STORAGE_S3_SECRET_KEY = 'sk';
      process.env.SUPABASE_STORAGE_S3_ENDPOINT =
        'https://x.supabase.co/storage/v1/s3';
      process.env.SUPABASE_MEETINGS_BUCKET = 'meetings';
      expect(service.isStorageConfigured()).toBe(true);
    });
  });

  describe('startRecording', () => {
    it('is a no-op when S3 storage is not configured', async () => {
      realConfig();
      await expect(service.startRecording('room-1')).resolves.toBe('');
    });
  });

  describe('ensureRoom', () => {
    it('short-circuits before any network call when unconfigured', async () => {
      await expect(
        service.ensureRoom({ roomName: 'room-1', recordingEnabled: true }),
      ).resolves.toBeUndefined();
    });
  });
});
