import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { findRefs } from '../engine/config';
import { toast, useStore } from '../store';
import { Confirm, ContextMenu, Dropdown, type MenuItem } from './ui';

export interface Col<T> {
  title: string;
  render: (r: T) => ReactNode;
  className?: string;
}

export interface Group<T> {
  title: string;
  rows: T[];
}

interface Props<T extends { key: string }> {
  groups: Group<T>[];
  cols: Col<T>[];
  onEdit: (row: T) => void;
  onCreate?: () => void;
  createMenu?: MenuItem[];
  onDelete?: (row: T) => void;
  onClone?: (row: T) => void;
  canDelete?: (row: T) => string | null;
  refPathOf?: (row: T) => string;
  extraTools?: ReactNode;
  rowClass?: (row: T) => string;
  search?: (row: T, q: string) => boolean;
}

/** A FortiOS-style object table: toolbar, collapsible groups, Ref. column, right-click menu. */
export function ObjectList<T extends { key: string }>(p: Props<T>) {
  const config = useStore((s) => s.config);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; row: T } | null>(null);
  const [confirm, setConfirm] = useState<T | null>(null);

  const all = p.groups.flatMap((g) => g.rows);
  const selected = all.find((r) => r.key === sel) ?? null;
  const refCount = (r: T) => (p.refPathOf ? findRefs(config, p.refPathOf(r), r.key).length : 0);
  const match = (r: T) => !q || (p.search ? p.search(r, q.toLowerCase()) : r.key.toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => p.groups.map((g) => ({ ...g, rows: g.rows.filter(match) })), [p.groups, q]); // eslint-disable-line

  const tryDelete = (r: T) => {
    const block = p.canDelete?.(r);
    if (block) return toast(block, 'err');
    const n = refCount(r);
    if (n > 0) return toast(`"${r.key}" cannot be deleted: it is used by ${n} other object${n > 1 ? 's' : ''} (see the Ref. column).`, 'err');
    setConfirm(r);
  };

  const cols = p.refPathOf ? [...p.cols, { title: 'Ref.', className: 'num', render: (r: T) => refCount(r) } as Col<T>] : p.cols;

  return (
    <>
      <div className="toolbar">
        {p.createMenu ? (
          <Dropdown label={<><Plus size={14} /> Create New</>} items={p.createMenu} />
        ) : (
          p.onCreate && (
            <button className="btn" onClick={p.onCreate}>
              <Plus size={14} /> Create New
            </button>
          )
        )}
        <button className="btn" disabled={!selected} onClick={() => selected && p.onEdit(selected)}>
          <Pencil size={14} /> Edit
        </button>
        {p.onClone && (
          <button className="btn" disabled={!selected} onClick={() => selected && p.onClone!(selected)}>
            <Copy size={14} /> Clone
          </button>
        )}
        {p.onDelete && (
          <button className="btn danger" disabled={!selected} onClick={() => selected && tryDelete(selected)}>
            <Trash2 size={14} /> Delete
          </button>
        )}
        {p.extraTools}
        <span className="grow" />
        <div className="search">
          <Search size={14} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.title} className={c.className}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const showHdr = groups.length > 1 || g.title !== '';
              const isClosed = closed[g.title];
              return (
                <Fragment key={g.title}>
                  {showHdr && (
                    <tr className="grp" onClick={() => setClosed({ ...closed, [g.title]: !isClosed })}>
                      <td colSpan={cols.length}>
                        {isClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g.title} ({g.rows.length})
                      </td>
                    </tr>
                  )}
                  {!isClosed &&
                    g.rows.map((r) => (
                      <tr
                        key={r.key}
                        className={`row ${sel === r.key ? 'selected' : ''} ${p.rowClass?.(r) ?? ''}`}
                        onClick={() => setSel(r.key)}
                        onDoubleClick={() => p.onEdit(r)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSel(r.key);
                          setMenu({ x: e.clientX, y: e.clientY, row: r });
                        }}
                      >
                        {cols.map((c) => (
                          <td key={c.title} className={c.className}>
                            {c.render(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {all.length === 0 && <div className="empty">No entries yet. Click "Create New".</div>}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Edit', icon: <Pencil size={14} />, onClick: () => p.onEdit(menu.row) },
            ...(p.onClone ? [{ label: 'Clone', icon: <Copy size={14} />, onClick: () => p.onClone!(menu.row) }] : []),
            ...(p.onDelete ? [{ label: 'Delete', icon: <Trash2 size={14} />, onClick: () => tryDelete(menu.row) }] : []),
          ]}
        />
      )}
      {confirm && (
        <Confirm
          msg={
            <>
              Are you sure you want to delete <b>{confirm.key}</b>?
            </>
          }
          onNo={() => setConfirm(null)}
          onYes={() => {
            p.onDelete!(confirm);
            setConfirm(null);
            setSel(null);
          }}
        />
      )}
    </>
  );
}
