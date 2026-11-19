import { fail } from './management.js';

export const ISSUE_KIT = 'issue-kit';
export const RETURN_KIT = 'return-kit';
export const STORES_DEMANDS = 'stores-demands';

const permissions = new Map([[ISSUE_KIT, 1], [RETURN_KIT, 2], [STORES_DEMANDS, 4]]);
export const ALL_PERMISSIONS = 7;

export function permissionMask(names) {
  if (!Array.isArray(names) || names.length > permissions.size)
    fail('Choose valid stores permissions.');
  let mask = 0;
  for (const name of names) {
    const bit = permissions.get(name);
    if (bit === undefined || (mask & bit)) fail('Choose valid stores permissions.');
    mask |= bit;
  }
  return mask;
}

export function permissionNames(mask) {
  return Array.from(permissions).filter(([, bit]) => mask & bit).map(([name]) => name);
}

export function hasPermission(account, permission) {
  if (account.role === 'admin') return true;
  return Boolean(permission ? account.permissions & permissions.get(permission) : account.permissions);
}
