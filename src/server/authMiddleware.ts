import type express from 'express';
import type { UserRole } from '../quant/types.ts';

export type HostSurfaceMode = 'USER_HOST' | 'ADMIN_HOST' | 'LOCAL_MULTI_SURFACE';

export interface AuthConfiguration {
  strictAuth: boolean;
  adminToken?: string;
  viewerToken?: string;
  collectorToken?: string;
}

export interface ResolvedAuthContext {
  authenticated: boolean;
  role: UserRole | null;
  explicitAuthAttempt: boolean;
  hostSurface: HostSurfaceMode;
  hostname: string;
}

export function detectHostSurfaceFromHostname(rawHostname: string): {
  hostSurface: HostSurfaceMode;
  normalizedHost: string;
} {
  const normalizedHost = (rawHostname || 'localhost')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  if (normalizedHost === 'adm.zupirus.com') {
    return { hostSurface: 'ADMIN_HOST', normalizedHost };
  }
  if (normalizedHost === 'zupirus.com' || normalizedHost === 'www.zupirus.com') {
    return { hostSurface: 'USER_HOST', normalizedHost };
  }
  return { hostSurface: 'LOCAL_MULTI_SURFACE', normalizedHost };
}

export function resolveRequestHostSurface(req: express.Request): {
  hostSurface: HostSurfaceMode;
  normalizedHost: string;
} {
  const headerHost =
    (typeof req.headers['x-forwarded-host'] === 'string' && req.headers['x-forwarded-host']) ||
    req.headers.host ||
    req.hostname ||
    'localhost';

  const baseDetection = detectHostSurfaceFromHostname(headerHost);

  // On localhost / preview environments, allow ?host= query or x-zupirus-surface-host header for acceptance testing
  if (baseDetection.hostSurface === 'LOCAL_MULTI_SURFACE') {
    const simulatedHost =
      (typeof req.query.host === 'string' && req.query.host) ||
      (typeof req.headers['x-zupirus-host'] === 'string' && req.headers['x-zupirus-host']);
    if (simulatedHost) {
      return detectHostSurfaceFromHostname(simulatedHost);
    }
  }

  return baseDetection;
}

export function createAuthMiddleware(config: AuthConfiguration) {
  const { strictAuth, adminToken, viewerToken, collectorToken } = config;
  const tokens = [adminToken, viewerToken, collectorToken].filter(Boolean);

  if (
    new Set(tokens).size !== tokens.length ||
    (strictAuth &&
      tokens.some((token) => token?.startsWith('zupirus-') && token.endsWith('-demo-token')))
  ) {
    throw new Error('Cấu hình token riêng cho từng vai trò.');
  }

  function resolveRequestRole(req: express.Request): ResolvedAuthContext {
    const { hostSurface, normalizedHost } = resolveRequestRequestHost(req);
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (!token) {
        return {
          authenticated: false,
          role: null,
          explicitAuthAttempt: true,
          hostSurface,
          hostname: normalizedHost,
        };
      }
      if (adminToken && token === adminToken) {
        return {
          authenticated: true,
          role: 'ADMIN',
          explicitAuthAttempt: true,
          hostSurface,
          hostname: normalizedHost,
        };
      }
      if (viewerToken && token === viewerToken) {
        return {
          authenticated: true,
          role: 'VIEWER',
          explicitAuthAttempt: true,
          hostSurface,
          hostname: normalizedHost,
        };
      }
      if (collectorToken && token === collectorToken) {
        return {
          authenticated: true,
          role: 'COLLECTOR',
          explicitAuthAttempt: true,
          hostSurface,
          hostname: normalizedHost,
        };
      }
      // Local non-strict development convenience tokens when no production token is set
      if (!strictAuth && hostSurface === 'LOCAL_MULTI_SURFACE') {
        if (!adminToken && token === 'local-admin-token') {
          return {
            authenticated: true,
            role: 'ADMIN',
            explicitAuthAttempt: true,
            hostSurface,
            hostname: normalizedHost,
          };
        }
        if (!viewerToken && token === 'local-viewer-token') {
          return {
            authenticated: true,
            role: 'VIEWER',
            explicitAuthAttempt: true,
            hostSurface,
            hostname: normalizedHost,
          };
        }
      }
      return {
        authenticated: false,
        role: null,
        explicitAuthAttempt: true,
        hostSurface,
        hostname: normalizedHost,
      };
    }

    if (strictAuth) {
      return {
        authenticated: false,
        role: null,
        explicitAuthAttempt: false,
        hostSurface,
        hostname: normalizedHost,
      };
    }

    // Default local preview & test compatibility when no auth headers are sent
    return {
      authenticated: true,
      role: 'VIEWER',
      explicitAuthAttempt: false,
      hostSurface,
      hostname: normalizedHost,
    };
  }

  function resolveRequestRequestHost(req: express.Request) {
    return resolveRequestHostSurface(req);
  }

  function requireRoles(
    allowedRoles: UserRole[],
    alwaysRequireExplicitToken = false
  ): express.RequestHandler {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (alwaysRequireExplicitToken) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({
            error: 'UNAUTHORIZED',
            messageVi:
              'Thiếu Bearer Token xác thực. Đầu cuối này bắt buộc xác thực token hợp lệ.',
          });
          return;
        }
      }

      const resolved = resolveRequestRole(req);
      if (!resolved.authenticated || !resolved.role) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          messageVi: 'Thông tin xác thực không hợp lệ hoặc bị từ chối.',
        });
        return;
      }

      // Enforce surface boundary: user domain (zupirus.com / www.zupirus.com) cannot execute ADMIN-only mutations
      if (
        resolved.hostSurface === 'USER_HOST' &&
        allowedRoles.length === 1 &&
        allowedRoles[0] === 'ADMIN'
      ) {
        res.status(403).json({
          error: 'FORBIDDEN_SURFACE',
          role: resolved.role,
          hostSurface: resolved.hostSurface,
          messageVi:
            'Tên miền người dùng (zupirus.com) không cho phép thực thi tác vụ quản trị. Vui lòng truy cập adm.zupirus.com.',
        });
        return;
      }

      if (!allowedRoles.includes(resolved.role)) {
        res.status(403).json({
          error: 'FORBIDDEN',
          role: resolved.role,
          allowedRoles,
          messageVi: `Vai trò ${resolved.role} không có quyền truy cập tài nguyên này (Yêu cầu: ${allowedRoles.join(', ')}).`,
        });
        return;
      }

      next();
    };
  }

  return {
    resolveRequestRole,
    requireRoles,
    strictAuth,
    hasConfiguredAdminToken: Boolean(adminToken),
    hasConfiguredViewerToken: Boolean(viewerToken),
  };
}
