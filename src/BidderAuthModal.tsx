/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modal version of the Bidders sign-in form. Used to gate sensitive auction
 * actions (e.g. removing a bidder from an item queue) behind a privileged
 * (Officer/Admin/Developer) credential check.
 */

import React, { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { BidderAuthForm } from './BidderAuthGate';
import { BidderActor, BidderRole } from './lib/apiBidders';

interface BidderAuthModalProps {
  open: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
  /** If provided, restricts the IGN dropdown + actor to these roles only. */
  allowedRoles?: BidderRole[];
  onAuth: (actor: BidderActor) => void;
  onCancel: () => void;
}

export default function BidderAuthModal({
  open,
  title = 'Authorize action',
  description = 'Officer, Admin, or Developer access required.',
  submitLabel,
  allowedRoles,
  onAuth,
  onCancel,
}: BidderAuthModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="px-5 py-5">
          <BidderAuthForm
            onAuth={onAuth}
            submitLabel={submitLabel}
            {...(allowedRoles ? { allowedRoles } : {})}
          />
        </div>
      </div>
    </div>
  );
}
