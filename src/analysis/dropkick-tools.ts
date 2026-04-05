import {KMLDataV1, KMLDisplayV1, GeodeticCoordinates, Vector3} from './dropkick-reader'
import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
import { traverseEllipsoid } from './rr-geodesy';

export function METERStoFEET(x: number): number {
    return (x) * 3.28084;
}

export function FEETtoMETERS(x: number) : number {
    return (x) * 0.3048;
}

export function METERStoNAUTICALMILES(x:number): number {
    return x * 0.000539957;
}

export function METERStoSTATUTEMILES(x:number): number {
    return x * 0.000621371;
}

export function KILOMETERStoNAUTICALMILES(x:number): number {
    return x * 0.539957;
}

export function KILOMETERStoSTATUTEMILES(x:number): number {
    return x * 0.621371;
}


export function RADtoDEG(x:number): number {
    return x * 180 / Math.PI;
}

/**
 * Perform 1D linear interpolation without extrapolation
 * @param xarray array of x values
 * @param varray array of y values corresponding to each point in xarray
 * @param x value to interpolate
 */
export function interp1(xarray: number[], varray: number[], x: number): number {
    if(x < xarray[0] || x > xarray[xarray.length-1]) {
        return NaN;
    }
    else {
        let last_x = xarray[0];
        let i=1;
        while( x > xarray[i] ) {
            last_x = xarray[i];
            i++;
        }
        const dx = x - last_x;
        return varray[i-1] + dx * (varray[i] - varray[i-1]) / (xarray[i] - xarray[i-1]);
    }
}

/**
 * Compute plottable values from the logged data series.
 *
 * @param samples
 * @param surfacePressureAlt_mMSL
 * @returns
 */
export const plottableValuesFromSamples = (samples: KMLDataV1[], surfacePressureAlt_mMSL: number) => {
    const estimatedHAT_G_m = surfacePressureAlt_mMSL;
    let lastSample: KMLDataV1 | null = null;
    const result = new Array<KMLDisplayV1>();
    samples.forEach( (cur) => {
        if (lastSample && lastSample.location && cur.location && cur.groundspeed_kmph && cur.groundtrack_degT) {
            const next: KMLDisplayV1 = {
                ...cur,
                GDot_mps: 0,
                HDot_mps: 0,
                XDot_kmph: 0,
                XDot_mph: 0,
                groundspeed_mph: 0,
                HDot_fpm: 0,
                gamma_deg: 0,
                H_ftAGL: 0,
                H_B_ftAGL: 0,
                H_B_mAGL: 0,
                TDLocation: null,
                FlareTDLocation: null,
                H_mAGL: 0,
                accelMag_mps2: 0
            };
            // we might have a quantization problem with 3D altitude report given
            // the short time scale (4Hz) between GNSS reports (3D altitudes reported with 10cm resolution)
            next.HDot_mps = (cur.location.alt_m - lastSample.location.alt_m) / (cur.timeOffset - lastSample.timeOffset);
            next.HDot_fpm = METERStoFEET( next.HDot_mps ) * 60;
            next.GDot_mps = cur.groundspeed_kmph * 1000 / 3600;
            next.XDot_kmph = Math.sqrt( next.GDot_mps * next.GDot_mps +  next.HDot_mps * next.HDot_mps ) * 3600 / 1000;
            next.XDot_mph= KILOMETERStoSTATUTEMILES(next.XDot_kmph);
            next.groundspeed_mph = KILOMETERStoSTATUTEMILES(cur.groundspeed_kmph);
            next.gamma_deg = RADtoDEG( Math.atan2(- next.HDot_mps, next.GDot_mps));

            const H_m = cur.location.alt_m - estimatedHAT_G_m;
            next.H_ftAGL = METERStoFEET(H_m);

            //
            next.H_B_ftAGL = null;  // barometric altitude above ground level
            next.H_B_mAGL = null;   // barometric altitude above ground level
            // if we have barometric altitude, compute H_B_ftAGL and
            //
            if (next.baroAlt_ft !== null) {
                next.H_B_ftAGL = next.baroAlt_ft - METERStoFEET(surfacePressureAlt_mMSL);
                next.H_B_mAGL = FEETtoMETERS(next.H_B_ftAGL);
            }

            // Compute estimated touchdown point

            if (next.H_B_mAGL !== null &&H_m < 1000.0 && next.HDot_mps < 0.0 ) {

                const TGo_sec = next.H_B_mAGL  / Math.abs(next.HDot_mps);           // no-flare time till touchdown
                const G_m = next.GDot_mps * TGo_sec;

                const p1 = new LatLon(cur.location.lat_deg, cur.location.lon_deg);
                const direct = p1.direct(G_m, cur.groundtrack_degT);
                const p2 = direct.point;

                // Note altitude is not exactly on the surface of the 3D map, but it should clamp to surface when visualized using Cesium
                next.TDLocation = { lat_deg: p2.latitude, lon_deg: p2.longitude, alt_m: surfacePressureAlt_mMSL };

                //next.TDLocation = traverseEllipsoid(cur.location, cur.groundtrack_degT, G_m)
            }
            else {
                next.TDLocation = null;
            }

            if (next.accel_mps2) {
                next.accelMag_mps2 = Math.sqrt(next.accel_mps2.x * next.accel_mps2.x +
                    next.accel_mps2.y * next.accel_mps2.y + next.accel_mps2.z * next.accel_mps2.z)
            }

            result.push( next )
        }
        lastSample = cur;
    })

    return result;
}
