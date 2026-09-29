export function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return null;
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : request.headers.get('x-admin-token');
  if (token !== expected) return new Response(JSON.stringify({error:'unauthorized'}), {status:401, headers:{'content-type':'application/json'}});
  return null;
}
