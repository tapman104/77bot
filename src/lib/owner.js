export function isOwner(userId, env) {
  if (!env.GLOBAL_ADMIN_IDS) return false;
  const adminList = env.GLOBAL_ADMIN_IDS.split(',').map(id => id.trim());
  return adminList.includes(String(userId));
}
