// lib/analysis/log-parser.ts

import { DropkickReader, KMLDataV1, GeodeticCoordinates, ReaderState, DeviceStateTransition, IM2Packet } from './dropkick-reader';

export interface TimeSeriesPoint {
  timestamp: number; // Seconds from log start
  value: number;
}

export interface GPSPoint {
  timestamp: number;  // Seconds from log start
  latitude: number;   // Degrees, positive north
  longitude: number;  // Degrees, positive east
  altitude_ftAGL: number; // feet, AGL (barometric preferred)
  groundspeed_kmph?: number; // Ground speed in km/h (from VTG)
  groundTrack_degT?: number; // Ground track heading in degrees wrt True North (from VTG)
}

export interface ParsedLogData {
  // Metadata
  startTime: Date;
  duration: number; // Total log duration in seconds
  sampleRate: number; // Hz

  // Time series data
  altitude: TimeSeriesPoint[]; // Altitude in feet (barometric, AGL)
  vspeed: TimeSeriesPoint[]; // Vertical speed in fpm (feet per minute)
  gps: GPSPoint[]; // GPS positions with barometric altitude
  gpsAltitude: TimeSeriesPoint[]; // GPS altitude in feet MSL
  staticPressure: TimeSeriesPoint[]; // Raw static pressure in hPa
  acceleration: TimeSeriesPoint[]; // IMU acceleration magnitude in m/s²

  // Raw parsed entries from DropkickReader
  logEntries: KMLDataV1[];

  // Flags
  hasGPS: boolean;
  hasValidData: boolean;
  errorMessage?: string;

  // Additional metadata from DropkickReader
  logVersion?: number;
  logString?: string;
  dzSurfacePressureAltitude_m?: number;
  dzSurfaceGPSAltitude_m?: number;

  // Device state transitions (from $PST sentences)
  stateTransitions: DeviceStateTransition[];

  // AHRS quaternion packets (from $PIM2 sentences, 20Hz)
  im2Packets: IM2Packet[];
}

export class LogParser {
  /**
   * Parse a raw jump log using DropkickReader
   * @param rawLog - Raw log data as Buffer
   * @returns Parsed time series data
   */
  static parseLog(rawLog: Buffer): ParsedLogData {
    const reader = new DropkickReader();

    try {
      // Convert buffer to string and split into lines
      const logString = rawLog.toString('utf-8');
      const lines = logString.split(/\r?\n/);

      console.log(`[PARSER] Parsing log of ${rawLog.length} bytes (${lines.length} lines)`);

      // Feed each line to the reader
      for (const line of lines) {
        if (line.trim()) {
          reader.onData(line);
        }
      }

      // Signal end of data
      reader.onClose();

      // Extract data from reader
      const logEntries = reader.logEntries;

      if (logEntries.length === 0) {
        return {
          startTime: new Date(),
          duration: 0,
          sampleRate: 0,
          altitude: [],
          vspeed: [],
          gps: [],
          gpsAltitude: [],
          staticPressure: [],
          acceleration: [],
          logEntries: [],
          hasGPS: false,
          hasValidData: false,
          errorMessage: 'No valid entries found in log',
          stateTransitions: [],
          im2Packets: [],
        };
      }

      // Determine start time and duration
      const startTime = reader.startDate || logEntries[0]?.timestamp || new Date();
      const endTime = reader.endDate || logEntries[logEntries.length - 1]?.timestamp || startTime;
      const duration = (endTime.getTime() - startTime.getTime()) / 1000;

      // Calculate approximate sample rate
      const sampleRate = logEntries.length > 1 ? logEntries.length / duration : 1;

      // Extract time series data
      const altitude: TimeSeriesPoint[] = [];
      const vspeed: TimeSeriesPoint[] = [];
      const gps: GPSPoint[] = [];
      const gpsAltitude: TimeSeriesPoint[] = [];
      const staticPressure: TimeSeriesPoint[] = [];
      const acceleration: TimeSeriesPoint[] = [];

      let hasGPS = false;

      for (const entry of logEntries) {
        // Use barometric altitude for altitude time series
        if (entry.baroAlt_ft !== null) {
          altitude.push({
            timestamp: entry.timeOffset,
            value: entry.baroAlt_ft
          });
        }

        // Use rate of descent (converted to vertical speed)
        if (entry.rateOfDescent_fpm !== null) {
          vspeed.push({
            timestamp: entry.timeOffset,
            value: -entry.rateOfDescent_fpm // Convert RoD to vspeed (positive up)
          });
        }

        // GPS altitude in feet MSL (from GNSS position fix)
        if (entry.location !== null) {
          hasGPS = true;
          gpsAltitude.push({
            timestamp: entry.timeOffset,
            value: this.metersToFeet(entry.location.alt_m)
          });
          gps.push({
            timestamp: entry.timeOffset,
            latitude: entry.location.lat_deg,
            longitude: entry.location.lon_deg,
            altitude_ftAGL: entry.baroAlt_ft !== null ? entry.baroAlt_ft :
                     this.metersToFeet(entry.location.alt_m), // Fallback to GPS altitude if no baro
            groundspeed_kmph: entry.groundspeed_kmph ?? undefined,
            groundTrack_degT: entry.groundtrack_degT ?? undefined
          });
        }

        // Raw static pressure for noise analysis
        if (entry.staticPressure_hPa !== null) {
          staticPressure.push({
            timestamp: entry.timeOffset,
            value: entry.staticPressure_hPa
          });
        }

        // IMU acceleration magnitude
        if (entry.accel_mps2 !== null) {
          const a = entry.accel_mps2;
          acceleration.push({
            timestamp: entry.timeOffset,
            value: Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
          });
        }
      }

      console.log(`[PARSER] Parsed successfully:`);
      console.log(`  - Start: ${startTime.toISOString()}`);
      console.log(`  - Duration: ${duration.toFixed(1)}s`);
      console.log(`  - Entries: ${logEntries.length}`);
      console.log(`  - Sample rate: ${sampleRate.toFixed(2)} Hz`);
      console.log(`  - Altitude points: ${altitude.length}`);
      console.log(`  - GPS altitude points: ${gpsAltitude.length}`);
      console.log(`  - Static pressure points: ${staticPressure.length}`);
      console.log(`  - Vspeed points: ${vspeed.length}`);
      console.log(`  - Acceleration points: ${acceleration.length}`);
      console.log(`  - GPS points: ${gps.length}`);
      console.log(`  - Log version: ${reader.logVersion} (${reader.logString})`);

      return {
        startTime,
        duration,
        sampleRate,
        altitude,
        vspeed,
        gps,
        gpsAltitude,
        staticPressure,
        acceleration,
        logEntries,
        hasGPS,
        hasValidData: true,
        logVersion: reader.logVersion,
        logString: reader.logString,
        dzSurfacePressureAltitude_m: reader.dzSurfacePressureAltitude_m,
        dzSurfaceGPSAltitude_m: reader.dzSurfaceGPSAltitude_m,
        stateTransitions: reader.stateTransitions,
        im2Packets: reader.im2Packets,
      };

    } catch (error) {
      console.error('[PARSER] Error parsing log:', error);
      return {
        startTime: new Date(),
        duration: 0,
        sampleRate: 0,
        altitude: [],
        vspeed: [],
        gps: [],
        gpsAltitude: [],
        staticPressure: [],
        acceleration: [],
        logEntries: [],
        hasGPS: false,
        hasValidData: false,
        errorMessage: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        stateTransitions: [],
        im2Packets: [],
      };
    }
  }

  /**
   * Convert meters to feet
   */
  private static metersToFeet(meters: number): number {
    return meters * 3.28084;
  }

  /**
   * Validate if the raw log appears to be valid jump data
   */
/**
   * Validate if the raw log appears to be valid jump data
   */
  static validateLog(rawLog: Buffer): {
    isValid: boolean;
    message?: string;
    startDate?: Date;
    startLocation?: GeodeticCoordinates;
  } {
    if (!rawLog || rawLog.length === 0) {
      return { isValid: false, message: 'Empty log file' };
    }

    if (rawLog.length < 100) {
      return { isValid: false, message: 'Log file too small' };
    }

    if (rawLog.length > 16 * 1024 * 1024) {
      return { isValid: false, message: 'Log file too large (>16MB)' };
    }

    // Process only the first 5KB worth of complete lines
    const sampleSize = Math.min(50 * 1024, rawLog.length);
    const sampleBuffer = rawLog.subarray(0, sampleSize);
    const sampleText = sampleBuffer.toString('utf-8');

    // Find the last complete line in our sample
    const lastNewline = sampleText.lastIndexOf('\n');
    if (lastNewline === -1) {
      return { isValid: false, message: 'No complete lines found' };
    }

    // Get only complete lines
    const completeText = sampleText.substring(0, lastNewline);
    const lines = completeText.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) {
      return { isValid: false, message: 'No valid lines found' };
    }

    // Use DropkickReader to validate
    const reader = new DropkickReader();
    let hasValidData = false;
    let errorCount = 0;

    try {
      // Process lines until we have both startDate and startLocation
      for (const line of lines) {
        try {
          reader.onData(line);

          // Check if we have what we need
          if (reader.startDate && reader.logEntries.length > 0) {
            const firstEntry = reader.logEntries[0];
            if (reader.startLocation) {
              // We have both date and location - validation successful
              return {
                isValid: true,
                startDate: reader.startDate,
                startLocation: reader.startLocation
              };
            }
          }

          // Track that we're processing valid NMEA data
          if (reader.state !== ReaderState.START) {
            hasValidData = true;
          }
        } catch (lineError) {
          errorCount++;
          // Continue processing other lines
        }
      }

      // If we processed data but didn't get complete info
      if (hasValidData) {
        if (!reader.startDate) {
          return { isValid: false, message: 'No valid RMC sentence found for date' };
        }
        if (!reader.startLocation) {
          return { isValid: false, message: 'No valid position data found' };
        }
        // Have date but no location yet - still valid, just incomplete
        return {
          isValid: true,
          startDate: reader.startDate,
          message: 'Valid log but location data not yet found in sample'
        };
      }

      // Check if we at least found version info
      if (reader.logVersion > 0) {
        return { isValid: false, message: 'Found version info but no valid GPS data' };
      }

      return { isValid: false, message: 'No valid NMEA sentences found' };

    } catch (error) {
      return {
        isValid: false,
        message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Extract key information from parsed data for analysis
   */
  static extractAnalysisData(parsedData: ParsedLogData): {
    hasBarometricData: boolean;
    hasGPSData: boolean;
    maxAltitude?: number;
    minAltitude?: number;
    maxVSpeed?: number;
    minVSpeed?: number;
    exitLocation?: GeodeticCoordinates;
    landingLocation?: GeodeticCoordinates;
  } {
    const result: any = {
      hasBarometricData: parsedData.altitude.length > 0,
      hasGPSData: parsedData.hasGPS
    };

    // Find altitude extremes
    if (parsedData.altitude.length > 0) {
      const altitudes = parsedData.altitude.map(p => p.value);
      result.maxAltitude = Math.max(...altitudes);
      result.minAltitude = Math.min(...altitudes);
    }

    // Find vspeed extremes
    if (parsedData.vspeed.length > 0) {
      const speeds = parsedData.vspeed.map(p => p.value);
      result.maxVSpeed = Math.max(...speeds);
      result.minVSpeed = Math.min(...speeds);
    }

    // Extract exit and landing locations from raw entries
    if (parsedData.logEntries.length > 0) {
      const firstEntry = parsedData.logEntries[0];
      const lastEntry = parsedData.logEntries[parsedData.logEntries.length - 1];

      if (firstEntry.location) {
        result.exitLocation = firstEntry.location;
      }

      if (lastEntry.location) {
        result.landingLocation = lastEntry.location;
      }
    }

    return result;
  }
}
