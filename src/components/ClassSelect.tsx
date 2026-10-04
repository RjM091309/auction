import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { MEMBER_CLASSES, type MemberClass } from '../lib/memberClasses';

interface ClassSelectProps {
  id?: string;
  value: MemberClass | null;
  onChange: (next: MemberClass | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Adds a "No class" row that clears the value. */
  allowClear?: boolean;
}

/**
 * Dark dropdown for the job class, styled like `NameDropdown` (no search —
 * the list is short). ArrowUp/Down + Enter pick, Esc / outside click close.
 */
export default function ClassSelect({
  id,
  value,
  onChange,
  disabled,
  placeholder = '— Select your class —',
  allowClear = false,
}: ClassSelectProps) {
  const options: (MemberClass | null)[] = allowClear ? [null, ...MEMBER_CLASSES] : [...MEMBER_CLASSES];
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIdx(Math.max(0, options.indexOf(value)));
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const commit = (idx: number) => {
    onChange(options[idx] ?? null);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(activeIdx);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">
          {value ? <span className="font-bold">{value}</span> : <span className="text-slate-500">{placeholder}</span>}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="custom-scrollbar absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl shadow-black/40"
        >
          {options.map((opt, idx) => {
            const isSelected = opt === value;
            const isActive = idx === activeIdx;
            return (
              <li key={opt ?? '__none'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => commit(idx)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : isActive
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span className={opt ? 'font-bold' : 'italic text-slate-400'}>{opt ?? 'No class'}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
