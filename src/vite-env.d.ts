/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  /** Public board polling interval (ms). */
  readonly VITE_PUBLIC_STATE_POLL_MS?: string;
  /** Public-side shuffle visual duration (ms). */
  readonly VITE_PUBLIC_SHUFFLE_VISUAL_MS?: string;
  /** Master toggle for the sure-win pin during shuffle ("true" to enable). */
  readonly VITE_SURE_WIN_ENABLED?: string;
  /** member.id that should always land at index 0 when the pin is enabled. */
  readonly VITE_SURE_WIN_MEMBER_ID?: string;
  /** Comma-separated item rules: `Name` or `Name:slot` (0=1st). Uses VITE_SURE_WIN_SLOT_INDEX as default slot. */
  readonly VITE_SURE_WIN_ITEM_NAME?: string;
  /** Default zero-based slot when an item rule has no `:slot` suffix (0=1st, 1=2nd, ...). */
  readonly VITE_SURE_WIN_SLOT_INDEX?: string;
  /** Comma-separated item ids that bypass the "one queue per IGN" gate. */
  readonly VITE_BID_LIMIT_EXEMPT_ITEM_IDS?: string;
  /** TZ used for the weekly auction rollover (default Asia/Manila). */
  readonly VITE_AUCTION_WEEK_TZ?: string;
  /** Dev-only Vite API proxy target. */
  readonly VITE_PROXY_API_TARGET?: string;
}
