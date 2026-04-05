// @tempo/core — shared analysis, formation, and visualization modules

// Formation types are canonical for shared geometric types (GeodeticCoordinates, Vector3)
export * from './formation';

// Analysis re-exports everything except types that conflict with formation
export {
  // dropkick-reader
  DropkickReader,
  ReaderState,
  type KMLDataV1,
  type KMLDisplayV1,
  type IM2Packet,
  type DeviceStateTransition,
  // dropkick-tools
  METERStoFEET,
  FEETtoMETERS,
  METERStoNAUTICALMILES,
  METERStoSTATUTEMILES,
  KILOMETERStoNAUTICALMILES,
  KILOMETERStoSTATUTEMILES,
  RADtoDEG,
  interp1,
  plottableValuesFromSamples,
  // event-detector
  EventDetector,
  type JumpEvents,
  // gps-path-utils
  type JumpPhase,
  type GeoJSONLineString,
  type GeoJSONPoint,
  type GeoJSONPointCollection,
  PHASE_COLORS,
  type GPSBounds,
  type PhaseSegment,
  gpsToGeoJSON,
  gpsToGeoJSONWithProperties,
  gpsToPointFeatures,
  getPhaseForTimestamp,
  filterByPhase,
  calculateBounds,
  calculateCenter,
  kmphToMph,
  mpsToMph,
  formatGroundspeed,
  getPhaseLabel,
  segmentByPhase,
  findClosestPoint,
  // kml-writer
  KMLWriter,
  // log-parser
  LogParser,
  type ParsedLogData,
  type GPSPoint,
  // rr-geodesy
  WGS84_MAJOR,
  WGS84_MINOR,
  WGS84_ECCENTRICITY,
  WGS84_ECCENTRICITY_SQR,
  PI_2,
  DEGtoRAD,
  normalizeLatitude,
  normalizeLongitude,
  traverseEllipsoid,
  traverse,
} from './analysis';

// Re-export TimeSeriesPoint from analysis (log-parser) explicitly
// since formation also defines a TimeSeriesPoint (different shape)
export { type TimeSeriesPoint as AnalysisTimeSeriesPoint } from './analysis/log-parser';

export * from './utils';
export * from './components';
