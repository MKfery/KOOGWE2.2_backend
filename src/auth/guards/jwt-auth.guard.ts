// src/auth/guards/jwt-auth.guard.ts
import {
  Injectable, ExecutionContext, UnauthorizedException,
  CanActivate, SetMetadata,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

// ─── @Public() — marque une route comme accessible sans JWT ───────────────
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ─── @Roles('ADMIN', 'DRIVER') ────────────────────────────────────────────
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// ─── JwtAuthGuard — appliqué GLOBALEMENT via APP_GUARD ────────────────────
// ✅ FIX V2: plus de risque d'oubli sur les routes admin
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) throw err || new UnauthorizedException('Token invalide ou expiré');
    return user;
  }
}

// ─── RolesGuard ───────────────────────────────────────────────────────────
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}
