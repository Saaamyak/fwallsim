import type { Config, Fields } from '../engine/types';
import { entries, find, renameObject, tableOf } from '../engine/config';
import { toast, updateConfig } from '../store';

const NAME_RE = /^[^"\\]{1,79}$/;

/** Object paths that share one name space in FortiOS (an address and a group can't share a name). */
const NAMESPACES: string[][] = [
  ['firewall address', 'firewall addrgrp', 'firewall vip', 'firewall vipgrp'],
  ['firewall service custom', 'firewall service group'],
  ['firewall schedule recurring', 'firewall schedule onetime', 'firewall schedule group'],
];

export function nameError(c: Config, path: string, oldKey: string | null, name: string): string | null {
  if (!NAME_RE.test(name.trim())) return 'Name is required (no quotes or backslashes, max 79 characters).';
  const ns = NAMESPACES.find((n) => n.includes(path)) ?? [path];
  if (name !== oldKey && ns.some((p) => find(c, p, name))) return `An object named "${name}" already exists.`;
  return null;
}

/**
 * Create or update a named entry. Renaming updates every reference to it, as the FortiOS GUI does.
 * Keeps "uuid" if the entry already has one.
 */
export function saveEntry(path: string, oldKey: string | null, newKey: string, fields: Fields, label: string): boolean {
  const ok = updateConfig(
    (c) => {
      const t = tableOf(c, path);
      if (oldKey && oldKey !== newKey) renameObject(c, path, oldKey, newKey);
      const row = t.entries.find((e) => e.key === newKey);
      if (row) row.f = { ...(row.f.uuid ? { uuid: row.f.uuid } : {}), ...fields };
      else t.entries.push({ key: newKey, f: fields });
    },
    `${oldKey ? 'Edit' : 'Add'} ${path.replace(' ', '.').replace(' ', '.')} ${newKey}`,
  );
  if (ok) toast(`${label} "${newKey}" saved`);
  return ok;
}

export function deleteEntry(path: string, key: string) {
  updateConfig((c) => (tableOf(c, path).entries = entries(c, path).filter((e) => e.key !== key)), `Delete ${path.replace(/ /g, '.')} ${key}`);
}
