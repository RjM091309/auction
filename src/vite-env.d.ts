/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  /** Public board polling interval (ms). */
  readonly VITE_PUBLIC_STATE_POLL_MS?: string;
  /** Comma-separated item ids that bypass the "one queue per IGN" gate. */
  readonly VITE_BID_LIMIT_EXEMPT_ITEM_IDS?: string;
  /** TZ used for the weekly auction rollover (default Asia/Manila). */
  readonly VITE_AUCTION_WEEK_TZ?: string;
  /** Dev-only Vite API proxy target. */
  readonly VITE_PROXY_API_TARGET?: string;
}
