import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createContext(
    user: { role: string } | null,
    roles?: string[],
  ): ExecutionContext {
    const handler = () => {};
    if (roles) {
      Reflect.defineMetadata('roles', roles, handler);
    }
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no roles are required', () => {
    const context = createContext({ role: 'STUDENT' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    const context = createContext({ role: 'ADMIN' }, ['ADMIN']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    const context = createContext({ role: 'GUARDIAN' }, ['TEACHER', 'ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('should deny access when no user is present', () => {
    const context = createContext(null, ['TEACHER']);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('should allow ADMIN to access TEACHER endpoints', () => {
    const context = createContext({ role: 'ADMIN' }, ['TEACHER', 'ADMIN']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny GUARDIAN access to TEACHER endpoints with 403', () => {
    const context = createContext({ role: 'GUARDIAN' }, ['TEACHER', 'ADMIN']);
    try {
      guard.canActivate(context);
      fail('should have thrown');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });
});
