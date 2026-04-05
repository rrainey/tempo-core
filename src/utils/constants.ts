// src/utils/constants.ts
//
// Shared constants for jump analysis across tempo-insights and tempo-testbed.
// Merged from both codebases — testbed tuning values + insights named constants.

/**
 * Fall Rate Analysis Constants
 * These values are tunable system settings for jump analysis
 */

// Average jumper fall rate band (calibrated, in mph)
// Reference: coordinate-frames.md - Analysis Scenario 1: Solo Jump Analysis
export const FALL_RATE_AVG_MIN = 115;
export const FALL_RATE_AVG_MAX = 125;

// Analysis window defaults
export const EXIT_STABILIZATION_TIME = 12.0; // seconds after exit to start analysis
export const DEPLOYMENT_BUFFER_TIME = 2.0;   // seconds before deployment to end analysis

// Bluetooth discovery
export const DISCOVERY_WINDOW = 300; // seconds (5 minutes)

// Event detection thresholds
export const EXIT_DETECTION_THRESHOLD_FPM = 2000; // vertical speed threshold for exit
export const EXIT_DETECTION_DURATION_SEC = 1.0;    // sustained duration required

export const PARACHUTE_ACTIVATION_DECEL_G = 0.25;  // deceleration threshold
export const PARACHUTE_ACTIVATION_DURATION_SEC = 0.1; // sustained duration

export const DEPLOYMENT_COMPLETE_THRESHOLD_FPM = 2000; // descent rate after deployment
export const LANDING_THRESHOLD_FPM = 100;              // descent rate for landing
export const LANDING_DURATION_SEC = 10.0;              // sustained duration for landing
