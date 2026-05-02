/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  /** Winner pick pool (top slots after shuffle). Optional; defaults in `shuffleCaps.ts`. */
  readonly VITE_AUCTION_WINNER_POOL_FRAGMENT?: string;
  readonly VITE_AUCTION_WINNER_POOL_LND?: string;
  readonly VITE_AUCTION_WINNER_POOL_TNS?: string;
  readonly VITE_AUCTION_WINNER_POOL_DEFAULT?: string;
}
