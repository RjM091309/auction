type SettingsToggleProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Styled on/off switch (not a native checkbox). */
export default function SettingsToggle({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: SettingsToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block cursor-pointer text-sm font-black uppercase tracking-wide text-slate-100"
        >
          {label}
        </label>
        {description ? (
          <p className="mt-1 text-[11px] font-medium leading-snug text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked
            ? 'border-blue-400/60 bg-blue-600'
            : 'border-slate-600 bg-slate-800'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
