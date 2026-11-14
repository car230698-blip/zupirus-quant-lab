import type { HostSurfaceMode } from '../server/authMiddleware.ts';

export type WorkspaceTabId =
  | 'USER_PORTFOLIO'
  | 'ADMIN_OPERATIONS';

export interface ClientHostRoutingContext {
  detectedHostname: string;
  effectiveHostname: string;
  hostSurface: HostSurfaceMode;
  isLocalMultiSurface: boolean;
  isUserDomainOnly: boolean;
  isAdminDomainOnly: boolean;
}

export function classifyHostname(hostname: string): HostSurfaceMode {
  const clean = (hostname || 'localhost').trim().toLowerCase().replace(/:\d+$/, '');
  if (clean === 'adm.zupirus.com') {
    return 'ADMIN_HOST';
  }
  if (clean === 'zupirus.com' || clean === 'www.zupirus.com') {
    return 'USER_HOST';
  }
  return 'LOCAL_MULTI_SURFACE';
}

export function resolveClientHostRouting(
  overrideHost?: string | null
): ClientHostRoutingContext {
  const browserHost =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const queryHost =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('host')
      : null;

  const baseSurface = classifyHostname(browserHost);
  const isLocal = baseSurface === 'LOCAL_MULTI_SURFACE';
  const effectiveHostname =
    isLocal && (overrideHost || queryHost)
      ? (overrideHost || queryHost || browserHost).trim().toLowerCase()
      : browserHost;

  const hostSurface = classifyHostname(effectiveHostname);

  return {
    detectedHostname: browserHost,
    effectiveHostname,
    hostSurface,
    isLocalMultiSurface: isLocal,
    isUserDomainOnly: hostSurface === 'USER_HOST',
    isAdminDomainOnly: hostSurface === 'ADMIN_HOST',
  };
}
