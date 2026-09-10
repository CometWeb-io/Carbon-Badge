/**
 * @cometweb/carbon-badge
 *
 * Lightweight web component showing CO₂e emissions per page view.
 * Powered by CometWeb & SWDM v4.
 *
 * Usage:
 *   <script type="module" src="https://unpkg.com/@cometweb/carbon-badge@1.0.8/dist/cometweb-carbon-badge.esm.js"></script>
 *   <cometweb-carbon-badge url="https://example.com"></cometweb-carbon-badge>
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
export type {
    BadgeData,
    ScoreLetter,
    BadgeTheme,
    BadgeMode,
    MeasurementStatus,
    MeasurementSource,
    APIResponse,
} from './types';

import { registerCarbonBadge } from './badge';

// Auto-register in browsers only — safe for SSR / Node imports (CB-03).
registerCarbonBadge();
