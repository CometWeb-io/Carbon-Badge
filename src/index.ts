/**
 * @cometweb/carbon-badge
 *
 * Lightweight web component showing CO₂e emissions per page view.
 * Powered by CometWeb & a documented SWDM v4 first-load lite approximation.
 *
 * Usage:
 *   <script type="module" src="https://unpkg.com/@cometweb/carbon-badge@1.0.8/dist/cometweb-carbon-badge.esm.js"></script>
 *   <cometweb-carbon-badge snapshot-id="<published_public_id>"></cometweb-carbon-badge>
 *
 * Or via npm:
 *   import { registerCarbonBadge } from '@cometweb/carbon-badge';
 *   registerCarbonBadge();
 */

export { CometWebCarbonBadge, registerCarbonBadge } from './badge';
export { estimateCO2, estimateCO2Detailed, co2ToScore } from './estimator';
export {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
} from './normalize';
export {
    DEFAULT_API_URL,
    DEFAULT_API_ORIGIN,
    validateApiUrl,
    calculateRetryDelay,
    fetchSingleFlight,
} from './api-client';
export {
    SCORE_MODEL_ID_COMETWEB_BANDS_V1,
    FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1,
} from './types';
export type {
    BadgeData,
    ScoreLetter,
    BadgeTheme,
    BadgeMode,
    MeasurementStatus,
    MeasurementSource,
    RetrievalSource,
    APIResponse,
} from './types';

import { registerCarbonBadge } from './badge';

// Auto-register in browsers only — safe for SSR / Node imports (CB-03).
registerCarbonBadge();
