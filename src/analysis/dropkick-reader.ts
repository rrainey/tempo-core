/* eslint-disable @typescript-eslint/prefer-as-const */
import { parseGenericPacket, DefaultPacketFactory, parseUnsafeNmeaSentence, getUnsafePacketId, UnsafePacket } from "nmea-simple";
import { initStubFields, PacketStub } from "nmea-simple/dist/codecs/PacketStub";
import { KMLWriter } from './kml-writer'
//import { getPackedSettings } from "http2";
import * as egm96 from 'egm96-universal'
import { FEETtoMETERS, METERStoFEET, interp1 } from "./dropkick-tools";

export interface GeodeticCoordinates {
	lat_deg: number,
	lon_deg: number,
	alt_m: number			// altitude, MSL (which must be converted from WGS-84 GPS)
};

export interface Vector3 {
	x: number,
	y: number,
	z: number
};

/**
 * Data items designed to be inserted into a KML export
 * of a log file - or to be used to plot the path
 */
export interface KMLDataV1 {
	seq: number,							// sequence number (integer)
	timeOffset:	number,						// seconds since start
	timeSinceMidnight_sec: number | null,	// seconds since midnight UTC on the log's calendar date (ms resolution)
	timestamp: Date | null,
	location: GeodeticCoordinates | null,
	groundtrack_degT: number | null,
	groundspeed_kmph: number | null | undefined,
	baroAlt_ft: number | null,
	staticPressure_hPa: number | null,
	rateOfDescent_fpm: number | null,		// barometric
	peakAccel_mps2: Vector3 | null,			// peak acceleration sampled during the interval
	accel_mps2: Vector3 | null,
	rot_rps: Vector3 | null,
}

/*
 * Extended computations based on KMLDataV1
 * These are not directly recorded in the log, but are derived from the log data
 * and are part of an experimental algorithm to estimate the touchdown point
 * based on current velocity vector, height above terrain (HAT),
 * and estimated time to touchdown.
 */
export interface KMLDisplayV1 extends KMLDataV1 {
	// all derived by computing deltas from the Nth GNSS sample with the (N-1)th sample
	// and, in some cases, converting metric to U.S.
	GDot_mps: number | null				// from GNSS fix
	HDot_mps: number | null				// from GNSS fix
	XDot_kmph: number | null			// from GNSS fix
	XDot_mph: number | null				// from GNSS fix
	HDot_fpm: number | null				// from GNSS fix
	groundspeed_mph: number | null		// from GNSS fix
	gamma_deg: number | null			// glide angle (deg) 0=flat, 90=vertical down (GNSS-based)

	// estimates based on terrain height(HAT), velocity vector and surface wind estimates (for flare)
	TDLocation: GeodeticCoordinates | null			// Requires HAT
	FlareTDLocation: GeodeticCoordinates | null		// Requires HAT

	// estimated height above surface, estimates based terrain height (HAT)
	H_mAGL:  number | null
	H_ftAGL:  number | null

	// estimated height above surface, estimates based terrain height (HAT)
	// value derived by subtracting landing pressure altitude from current pressure altitude
	H_B_mAGL:  number | null
	H_B_ftAGL:  number | null

	accelMag_mps2: number | null
}

const timeHackSentenceId: "_TH" = "_TH";

interface TimeHackPacket extends PacketStub<typeof timeHackSentenceId> {
	timestamp_ms: number;
}

const envSentenceId: "_ENV" = "_ENV";

interface EnvironmentPacket extends PacketStub<typeof envSentenceId> {
	timestamp_ms: number;
	pressure_hPa: number;
	estimatedAlt_ft: number;
	vBatt_volts: number;
}

const envSurfaceElevationId: "_SFC" = "_SFC";

interface EnvironmentSurfacePacket extends PacketStub<typeof envSurfaceElevationId> {
	elevation_ft: number;  // estimated surface elevation (MSL) - based solely on barometric pressure
}

const imuSentenceId: "_IMU" = "_IMU";

interface IMUPacket extends PacketStub<typeof imuSentenceId> {
	timestamp_ms: number;
	accX_mps2: number;
	accY_mps2: number;
	accZ_mps2: number;
	rotX_rps: number;
	rotY_rps: number;
	rotZ_rps: number;
}

const im2SentenceId: "_IM2" = "_IM2";

export interface IM2Packet extends PacketStub<typeof im2SentenceId> {
	timestamp_ms: number;
	q0: number;  // w (scalar)
	q1: number;  // x
	q2: number;  // y
	q3: number;  // z
	timeOffset?: number;  // seconds from log start (computed from PTH correlation)
}

const verSentenceId: "_VER" = "_VER";

interface LogVersionPacket extends PacketStub<typeof verSentenceId> {
	versionNumber: number;
	versionString: string;
}

const txtSentenceId: "_TXT" = "_TXT";

interface UBloxTextPacket extends PacketStub<typeof txtSentenceId> {
	message: string;
}

const fixSentenceId: "_FIX" = "_FIX";

interface FixPacket extends PacketStub<typeof fixSentenceId> {
	timestamp_ms: number;
	tod_utc: string;
	lat_str: string;
	lon_str: string;
	altitude_m: number;
	fixQuality_str: string;
	hdop: number;
	vdop: number;
	x_str: string;
	y_str: string;
}

const stateSentenceId: "_ST" = "_ST";

interface StatePacket extends PacketStub<typeof stateSentenceId> {
	timestamp_ms: number;
	fromState: string;
	toState: string;
}


export interface DeviceStateTransition {
	fromState: string;
	toState: string;
	timeOffset_sec: number;	// estimated time offset from log start
}

export enum ReaderState {
	START,			// Initial state, process version information
	SEEKING_RMC,	// version info processed, look for first RMC record to establish date
	NORMAL_1,       // Date known, process GNSS records, average PIMU values, record changes in baro altitude
	NORMAL_2,       // Post GGA, or GLL message; use PTH to establish correlation between GPS time and millis(), return to NORMAL_1
	END
}

type CustomPackets = TimeHackPacket | EnvironmentPacket | IMUPacket |
	LogVersionPacket | UBloxTextPacket | IM2Packet | EnvironmentSurfacePacket |	FixPacket | StatePacket;

class CustomPacketFactory extends DefaultPacketFactory<CustomPackets> {

	assembleCustomPacket(stub: PacketStub, fields: string[]): CustomPackets | null {
		if (stub.talkerId === "P") {
			if (stub.sentenceId === timeHackSentenceId) {
				return {
					...initStubFields(stub, timeHackSentenceId),
					timestamp_ms: parseInt(fields[1], 10)
				};
			}
			else if (stub.sentenceId === envSentenceId) {
				return {
					...initStubFields(stub, envSentenceId),
					timestamp_ms: parseInt(fields[1], 10),
					pressure_hPa: parseFloat(fields[2]),
					estimatedAlt_ft: parseFloat(fields[3]),
					vBatt_volts: parseFloat(fields[4])
				};
			}
			else if (stub.sentenceId === imuSentenceId) {
				return {
					...initStubFields(stub, imuSentenceId),
					timestamp_ms: parseInt(fields[1], 10),
					accX_mps2: parseFloat(fields[2]),
					accY_mps2: parseFloat(fields[3]),
					accZ_mps2: parseFloat(fields[4]),
					rotX_rps: parseFloat(fields[5]),
					rotY_rps: parseFloat(fields[6]),
					rotZ_rps: parseFloat(fields[7])
				};
			}
			else if (stub.sentenceId === im2SentenceId) {
				return {
					...initStubFields(stub, im2SentenceId),
					timestamp_ms: parseInt(fields[1], 10),
					q0: parseFloat(fields[2]),
					q1: parseFloat(fields[3]),
					q2: parseFloat(fields[4]),
					q3: parseFloat(fields[5]),
				};
			}
			else if (stub.sentenceId === envSurfaceElevationId) {
				return {
					...initStubFields(stub, envSurfaceElevationId),
					elevation_ft: parseFloat(fields[1]),
				};
			}
			else if (stub.sentenceId === verSentenceId) {
				// fields[2] is like "V1" - extract the number after the "V" prefix
				const versionField = fields[2] || '';
				const versionNum = versionField.startsWith('V')
					? parseInt(versionField.substring(1), 10)
					: parseInt(versionField, 10);
				return {
					...initStubFields(stub, verSentenceId),
					versionString: fields[1],
					versionNumber: versionNum
				};
			}
			else if (stub.sentenceId === fixSentenceId) {
				return {
					...initStubFields(stub, fixSentenceId),
					timestamp_ms: parseInt(fields[1], 10),
					tod_utc: fields[2],
					lat_str: fields[3],
					lon_str: fields[4],
					altitude_m: parseFloat(fields[5]),
					fixQuality_str: fields[6],
					hdop: parseFloat(fields[7]),
					vdop: parseFloat(fields[8]),
					x_str: fields[9],
					y_str: fields[10]
				};
			}
			else if (stub.sentenceId === stateSentenceId) {
				return {
					...initStubFields(stub, stateSentenceId),
					timestamp_ms: parseInt(fields[1], 10),
					fromState: fields[2],
					toState: fields[3],
				};
			}
		}

		return null;
	}
}

const CUSTOM_PACKET_FACTORY = new CustomPacketFactory();

export class DropkickReader {

	constructor() {
		this.when = new Array<Date>();
		this.location = new Array<GeodeticCoordinates>();
		this.goundtrack_degTrue = new Array<number>();
		this.groundspeed_mps = new Array<number>();
		this.baroAlt_m = new Array<number>();
		this.baroRate_mps = new Array<number>();
		this.imuAcc_mps2 = new Array<Vector3>();
		this.imuRot_rps = new Array<Vector3>();
		this.rawUploadId = '';
		this.startDate = null;
		this.endDate = null;
		this.calendarDate = undefined;
		this.startLocation = null;
		this.endLocation = null;
		this.state = ReaderState.START;
		this.logVersion = -1;
		this.logString = 'unspecified';
		this.logEntries = new Array<KMLDataV1>();
		this.curEntry = this.cleanKMLEntry();
		this.imuSamplesThisInterval = 0;
		this.lastEnvTimestamp_ms = 0;
		this.lastTimeHackTimestamp_ms = 0;
		this.lastEnvAlt_ft = 0;
		this.seq = 1;
		// initialize vectors to zero
		this.maxAcc = { x: 0, y: 0, z: 0 };
		this.acc = { x: 0, y: 0, z: 0 };
		this.rot = { x: 0, y: 0, z: 0 };
		this.numImuSamples = 0;
		this.maxAccMag_mps2 = 0;
		this.altFilterMax = 8;
		this.altFilter = new Array<number>();
		this.altFilterSum = 0.0;
		this.envAltSeries_ft = new Array<number>();
		this.envSampleTimeSeries_ft = new Array<number>();
		this.expectGGATimehack = false;
		this.lastTimeOffset_sec = 0;
		this.dzSurfacePressureAltitude_m = NaN;
		this.dzSurfaceGPSAltitude_m = NaN;
		this.lastGNSSAltitude_m = NaN;
		this.lastGNSSTimeOffset_sec = NaN;
		this.stateTransitions = [];
		this.lastDeviceState = 'LOGGING';
		this.im2Packets = [];

	}

	when: Date[];
	location: GeodeticCoordinates[];
	goundtrack_degTrue: number[];
	groundspeed_mps: number[];
	baroAlt_m: number[];
	baroRate_mps: number[];
	imuAcc_mps2: Vector3[];
	imuRot_rps: Vector3[];
	rawUploadId: string;
	calendarDate?: Date;				// calendar date of first GNSS entry in log
	currentCalendarDate?: Date;			// tracked calendar date as the log is processed. valid in SEEKING_RMC and NORMAL_ states
	startDate?: Date | null;		 	// JS Dates assure at least millisecond precision for the date ranges of interest
	endDate?: Date | null;
	startLocation?: GeodeticCoordinates | null;
	endLocation?: GeodeticCoordinates | null;
	state: ReaderState;
	logVersion: number;
	logString: string;
	logEntries: KMLDataV1[];
	curEntry: KMLDataV1;
	imuSamplesThisInterval: number;
	lastEnvTimestamp_ms: number;
	lastTimeHackTimestamp_ms: number;
	lastTimeOffset_sec: number;			// as we process the series, this will reflect the time offset (sec) for the last entry we have processed
	lastEnvAlt_ft: number;				// last barometric altitude from PENV sentence (ft,MSL)
	seq: number;
	acc: Vector3;
	maxAcc: Vector3;
	rot: Vector3;
	numImuSamples: number;
	altFilter: number[];
	altFilterMax: number;
	altFilterSum: number;
	maxAccMag_mps2: number;
	envAltSeries_ft: number[];
	envSampleTimeSeries_ft: number[];
	expectGGATimehack: boolean;
	dzSurfacePressureAltitude_m: number;	// Pressure Altitude @ DZ surface
	dzSurfaceGPSAltitude_m: number;			// GNSS reported surface elevation (discounting carrying location)
	lastGNSSAltitude_m: number;				// Saved GNSS altitude for use in estimating GPS-based surface elevation
	lastGNSSTimeOffset_sec: number;
	stateTransitions: DeviceStateTransition[];	// $PST state transitions (e.g. LOGGING→JUMPED)
	lastDeviceState: string;
	im2Packets: IM2Packet[];					// $PIM2 AHRS quaternion packets (20Hz)


	// Experimental; not fully implemented
	// This is the approximate difference between GGA/GGL arrival and PTH - taking into account time to send both over I2C I/F
	// subtract this from the arriving PTH value to get closer to the millis() time when GGA/GGL was computed
	// This currently amount to an extra 4.7ms that we'll add into the millis() to GNSS time alignment calculation.
	i2cSpeed_bps: number = 100000;
	timeHackSerialAdjustment_ms: number = ((76 * 8) - (17 * 8) / this.i2cSpeed_bps);

	cleanKMLEntry(): KMLDataV1 {
		return {
			seq: 0,
			timeOffset: 0,
			timeSinceMidnight_sec: null,
			timestamp: null,
			location: null,
			groundtrack_degT: null,
			groundspeed_kmph: null,
			baroAlt_ft: null,
			staticPressure_hPa: null,
			rateOfDescent_fpm: null,
			peakAccel_mps2: null,
			accel_mps2: null,
			rot_rps: null,
		};
	}

	zeroVector3(): Vector3 {
		return { x: 0, y: 0, z: 0};
	}

	generateKML(name: string): string {
		const kml = new KMLWriter();
		if (!this.startDate) {
			this.startDate = new Date();
		}
		if (!this.endDate) {
			this.endDate = new Date();
		}
		return kml.generate(name, name, this.startDate, this.endDate, this.logEntries);
	}

	appendChecksumIfMissing(line: string): string {

		let res: string = line;
		res = res.replace("$PTH", "$P_TH");
		res = res.replace("$PENV", "$P_ENV");
		res = res.replace("$PIMU", "$P_IMU");
		res = res.replace("$PIM2", "$P_IM2");
		res = res.replace("$PVER", "$P_VER");
		res = res.replace("$PSFC", "$P_SFC");
		res = res.replace("$PFIX", "$P_FIX");
		res = res.replace("$PST", "$P_ST");
		// recalculate checksums; really we should be manually validating the existing checksum prior to doing the
		// "replace" statements above ...
		const lineEnd = res.lastIndexOf("*");
		if (lineEnd != -1) {
			res = res.substring(0,lineEnd);
		}

		const delimeter: string = res.substring(res.length - 3, res.length - 2);
		if (delimeter !== "*" && res.substring(0, 1) === "$") {

			let checksum: number = 0;
			for (let i: number = 1; i < res.length; i++) {
				checksum = checksum ^ res.charCodeAt(i);
			}
			if (checksum < 16) {
				res = res + "*0" + checksum.toString(16).toUpperCase();
			}
			else {
				res = res + "*" + checksum.toString(16).toUpperCase();
			}
		}
		return res;
	}

	/*
	 * We'll build a stream of position reports, each one triggered by a logged RMC record.
	 * Intermediate record types (GGA, VTG, $PIMU, $PIM2, $PENV) will be used to add details.
	 * This ends up being a simplified log, but captures the detail needed for graph rendering.
	 */
	onData(line: string): void {

		const patched: string = this.appendChecksumIfMissing(line);

		try {

			const packet = parseGenericPacket(patched, CUSTOM_PACKET_FACTORY);

			// RMC
			// VTG
			// GGA

			switch( this.state ) {
				case ReaderState.START:
					if (packet.sentenceId === "_VER") {
						this.logVersion = packet.versionNumber;
						this.logString = packet.versionString;
						this.state =  ReaderState.SEEKING_RMC;
					}
					else if (packet.sentenceId === envSurfaceElevationId) {
						// Surface elevation (MSL) at the drop zone
						this.dzSurfacePressureAltitude_m = FEETtoMETERS(packet.elevation_ft);
					}
					break;

				case ReaderState.SEEKING_RMC:
					if (packet.sentenceId === "RMC" && packet.status === "valid") {
						// use RMC for track, speed, and date (not time)
						console.log("Got location via RMC packet:", packet.datetime, packet.latitude, packet.longitude, packet.trackTrue, packet.speedKnots);
						const fullDateTime_ms: number = packet.datetime.getTime();
						const timePortion_ms = fullDateTime_ms % (86400000);
						this.calendarDate = new Date(fullDateTime_ms - timePortion_ms);
						this.currentCalendarDate = this.calendarDate;
						this.startDate = packet.datetime;
						//const timePortion = (myDate.getTime() - myDate.getTimezoneOffset() * 60 * 1000) % (3600 * 1000 * 24);
						this.state =  ReaderState.NORMAL_1;
						this.curEntry = this.cleanKMLEntry();
						this.maxAcc = { x: 0, y: 0, z: 0 };
						this.acc = { x: 0, y: 0, z: 0 };
						this.rot = { x: 0, y: 0, z: 0 };
						this.numImuSamples = 0;
						this.maxAccMag_mps2 = 0;
					}
					else if (packet.sentenceId === envSurfaceElevationId) {
						// Surface elevation (MSL) at the drop zone
						this.dzSurfacePressureAltitude_m = FEETtoMETERS(packet.elevation_ft);
					}
					break;

				case ReaderState.NORMAL_1:
				case ReaderState.NORMAL_2:
					if (packet.sentenceId === "RMC" && packet.status === "valid") {

						const fullDateTime_ms: number = packet.datetime.getTime();
						const timePortion_ms = fullDateTime_ms % (86400000);
						this.calendarDate = new Date(fullDateTime_ms - timePortion_ms);
						this.currentCalendarDate = this.calendarDate;

						//console.log("Got location via RMC packet:", packet.datetime, packet.latitude, packet.longitude, packet.trackTrue, packet.speedKnots);
					}

					else if (packet.sentenceId === "VTG") {
						// Use VTG to get FAA mode
						this.curEntry.groundtrack_degT = packet.trackTrue;
						this.curEntry.groundspeed_kmph = packet.speedKmph;
						//console.log("Got location via VTG packet:", packet.trackTrue, packet.speedKmph, packet.faaMode);
					}

					else if (packet.sentenceId === "GGA") {
						// Process ALL GGA sentences, even those without a valid fix.
						// No-fix entries still get barometric altitude (via onClose interpolation)
						// and IMU data, just without GNSS position or GNSS-derived RoD.
						const hasValidFix = packet.fixType !== "none";

						const fullDateTime_ms: number = packet.time.getTime();
						const timePortion_ms = fullDateTime_ms % (86400000);
						let correctedTimestamp = new Date(fullDateTime_ms);
						// TODO handle first entry more gracefully
						if (this.currentCalendarDate !== undefined && this.startDate !== null && this.startDate !== undefined) {
							correctedTimestamp = new Date( this.currentCalendarDate.getTime() + timePortion_ms);
							this.curEntry.timeOffset = (correctedTimestamp.getTime() - this.startDate.getTime()) / 1000.0;
							this.curEntry.timeSinceMidnight_sec = timePortion_ms / 1000.0;
						}
						this.lastTimeOffset_sec = this.curEntry.timeOffset;
						this.curEntry.timestamp = correctedTimestamp;
						this.expectGGATimehack = true;

						// Only populate location and GNSS-derived fields when we have a valid fix
						if (hasValidFix) {
							this.curEntry.location = {
								lat_deg: packet.latitude,
								lon_deg: packet.longitude,
								alt_m: packet.altitudeMeters // WGS-84
							}
							if (this.startLocation === null) {
								this.startLocation = this.curEntry.location;
							}

							/*
							 * Rate of descent derives from GNSS data.
							 * It is proving to be far less noisy than barometric RoD
							 */
							if (!isNaN(this.lastGNSSAltitude_m) && !isNaN(this.lastGNSSTimeOffset_sec)) {
								this.curEntry.rateOfDescent_fpm = - (packet.altitudeMeters - this.lastGNSSAltitude_m) /
									(this.curEntry.timeOffset - this.lastGNSSTimeOffset_sec) * 196.850394; // m/s to fpm
							}

							if (!isNaN(packet.altitudeMeters)) {
								this.lastGNSSAltitude_m = packet.altitudeMeters;
								this.lastGNSSTimeOffset_sec = this.curEntry.timeOffset;
							}
						}
						// else: location remains null, rateOfDescent_fpm remains null

						// Save last complete log entry if present
						if (this.curEntry.timestamp) {
							this.endDate = this.curEntry.timestamp;
							this.curEntry.seq = this.seq++;
							this.curEntry.accel_mps2 = {
								x: this.acc.x / this.numImuSamples,
								y: this.acc.y / this.numImuSamples,
								z: this.acc.z / this.numImuSamples
							};
							this.curEntry.rot_rps = {
								x: this.rot.x / this.numImuSamples,
								y: this.rot.y / this.numImuSamples,
								z: this.rot.z / this.numImuSamples
							};
							this.curEntry.peakAccel_mps2 = this.maxAcc;

							this.logEntries.push( this.curEntry );

							this.maxAcc = { x: 0, y: 0, z: 0 };
							this.acc = { x: 0, y: 0, z: 0 };
							this.rot = { x: 0, y: 0, z: 0 };
							this.numImuSamples = 0;
							this.maxAccMag_mps2 = 0;
							this.curEntry = this.cleanKMLEntry();
						}
						//console.log("Got location via GGA packet:", correctedTimestamp, packet.time, packet.latitude, packet.longitude, packet.altitudeMeters, packet.fixType);
					}

					else if (packet.sentenceId === imuSentenceId) {
						const mag_msp2 = Math.sqrt( packet.accX_mps2 * packet.accX_mps2 +
							packet.accY_mps2 * packet.accY_mps2 +
							packet.accZ_mps2 * packet.accZ_mps2);

						this.acc.x += packet.accX_mps2;
						this.acc.y += packet.accY_mps2;
						this.acc.z += packet.accZ_mps2;
						this.rot.x += packet.rotX_rps;
						this.rot.y += packet.rotY_rps;
						this.rot.z += packet.rotZ_rps;

						if (this.maxAccMag_mps2 < mag_msp2) {
							this.maxAccMag_mps2 = mag_msp2;
							this.maxAcc = this.acc;
						}

						this.numImuSamples ++;
					}

					else if (packet.sentenceId === im2SentenceId) {
						// AHRS quaternion (20Hz) — convert device millis() to timeOffset using PTH correlation
						const timeOffset = this.lastTimeOffset_sec +
							(packet.timestamp_ms - this.lastTimeHackTimestamp_ms + this.timeHackSerialAdjustment_ms) / 1000.0;
						this.im2Packets.push({ ...packet, timeOffset });
					}

					else if (packet.sentenceId === envSentenceId) {
						// Simple moving average filter for altitude (average of last N entries)
						this.altFilterSum += packet.estimatedAlt_ft; // Standard day - uncorrected for current conditions
						this.altFilter.push( packet.estimatedAlt_ft );
						if (this.altFilter.length > this.altFilterMax) {
							const shifted = this.altFilter.shift();
							if (shifted !== undefined) {
								this.altFilterSum -= shifted;
							}
						}
						const baroAlt_ft = this.altFilterSum / this.altFilter.length;
						this.curEntry.staticPressure_hPa = packet.pressure_hPa;
						// Use filtered altitude for rate of descent calculation (deprecated)

						if (false && this.lastEnvTimestamp_ms != 0.0) {
							//const interval_ms = packet.timestamp_ms - this.lastEnvTimestamp_ms;
							//this.curEntry.rateOfDescent_fpm = - (baroAlt_ft - this.lastEnvAlt_ft) / interval_ms * 60000.0;
						}
						this.lastEnvTimestamp_ms = packet.timestamp_ms;
						this.lastEnvAlt_ft = baroAlt_ft;

						// save (filtered) altitude samples as a time series (expressed as log start time offsets (sec)).
						// We will use this later generate interpolated values that will correspond to the time offsets appearing in
						// the recorded sample series.
						this.envAltSeries_ft.push(baroAlt_ft - METERStoFEET(this.dzSurfacePressureAltitude_m));
						this.envSampleTimeSeries_ft.push(this.lastTimeOffset_sec +
							(packet.timestamp_ms - this.lastTimeHackTimestamp_ms + this.timeHackSerialAdjustment_ms) / 1000.0);

					}

					else if (packet.sentenceId == timeHackSentenceId && this.expectGGATimehack) {
						// Time Hack sentences are used to correlate millis() time to the UTC time in GNSS postion reports.
						// TH sentence will appear after several types of NMEA sentences -- in order to get the most
						// accurate correspondence between millis(0 time and GNSS (UTC) time, we only want to consider
						// the TH sentences that correspond to GGA sentences, as those are used for time/position entries in the final time series.
						this.lastTimeHackTimestamp_ms = packet.timestamp_ms;
						this.expectGGATimehack = false;
					}

					else if (packet.sentenceId === stateSentenceId) {
						// Device state transition (e.g. LOGGING → JUMPED)
						// $PST format: $PST,timestamp_ms,fromState,toState
						// Convert millis() timestamp to time offset using PTH correlation
						const timeOffset_sec = this.lastTimeOffset_sec +
							(packet.timestamp_ms - this.lastTimeHackTimestamp_ms + this.timeHackSerialAdjustment_ms) / 1000.0;

						this.stateTransitions.push({
							fromState: packet.fromState,
							toState: packet.toState,
							timeOffset_sec,
						});
						console.log(`[READER] State transition: ${packet.fromState} → ${packet.toState} at ${timeOffset_sec.toFixed(1)}s`);
						this.lastDeviceState = packet.toState;
					}

					break;

				default:

			}

		} catch (error) {
			//console.error("Got bad packet:", patched, error);
			const packet: UnsafePacket = parseUnsafeNmeaSentence(patched);

			if ( getUnsafePacketId(packet) == 'TXT' ) {
				console.log("ublox error message: " + patched)
			}
			else {
				console.log("Unrecognized NMEA sentence:" + patched);
			}
		}

	};

	onClose() {
		/*
		 * postprocessing
		 */
		this.state = ReaderState.END;

		// Do we have a usable DZ surface elevation?

		let dzSurfaceElevation_ftMSL = 0.;
		if (!isNaN(this.dzSurfacePressureAltitude_m)) {
			dzSurfaceElevation_ftMSL = METERStoFEET(this.dzSurfacePressureAltitude_m);
		}

		/*
		 * Generate interpolated estimates for altitude at each sample point using data from $PENV time series.
		 * Note: envAltSeries_ft already contains AGL values (surface elevation subtracted in line 593)
		 */
		this.logEntries.forEach( (entry) => {
			entry.baroAlt_ft = interp1(this.envSampleTimeSeries_ft, this.envAltSeries_ft, entry.timeOffset);
		})
	};

};
