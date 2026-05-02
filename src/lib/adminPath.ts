/** Guild admin SPA lives at `/admin` (with or without trailing slash). */
export function isAdminPath(pathname: string): boolean {
  const path = (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return path === '/admin';
}
