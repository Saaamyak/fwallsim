// Canonical config tree, shaped like a FortiOS configuration file.
// GUI, CLI and the packet engine all read/write this one structure.

export type FieldValue = string | string[] | ConfigTable | ConfigObject;
export type Fields = Record<string, FieldValue>;

export interface ConfigEntry {
  key: string; // the "edit <key>" value
  f: Fields; // explicitly-set fields only; defaults come from the schema
}

export interface ConfigTable {
  kind: 'table';
  entries: ConfigEntry[]; // order matters (e.g. firewall policy sequence)
}

export interface ConfigObject {
  kind: 'object';
  f: Fields;
}

export type Config = Record<string, ConfigTable | ConfigObject>;
