import { GeodeticCoordinates } from "./dropkick-reader";

/** WGS84 equatorial semi-axis "a" (m). */
export const WGS84_MAJOR	 = 6378137.0

/** WGS84 polar semi-axis "b" (m). */
export const WGS84_MINOR =	6356752.3142

/** Eccentricity = sqrt(1 - (b/a)^2). */
export const WGS84_ECCENTRICITY =	0.081819190928906199466

/** Eccentricity squared. */
export const WGS84_ECCENTRICITY_SQR =	0.006694380004260806515

export const PI_2 = Math.PI / 2.0;

export function DEGtoRAD(a: number) {
    return (a * Math.PI / 180.0);
}

function RADtoDEG(a: number) {
    return (a * 180.0 / Math.PI);
}

export function normalizeLatitude(a:number):number {
	while (a > PI_2) {
		a -= PI_2
	}
	while (a < -PI_2) {
		a += PI_2
	}
	return a;
}

export function normalizeLongitude(a:number):number {
	while (a > Math.PI) {
		a -= Math.PI
	}
	while (a < -Math.PI) {
		a += Math.PI
	}
	return a;
}

/*
 * Borrowed from my original ACM flight simulator source code (globe.c)
 *
 *  In the DIS 2.0 coordinate system:
 *
 *      positive Z axis is North;
 *      positive X axis points to 0N, 0E;
 *      positive Y axis points to 0N 90E.
 *
 *  So, North latitudes are positive; East longitudes are positive.
 *
 *  The world is considered a perfect ellipsoid based on the WGS84
 *  standard -- no correction is made to take into account height differences
 *  between the ellpsoid and the geoid.
 *
 *  "The Surveying Handbook", edited by Brinker and Minnick contains a decent
 *  discussion of the technical issues required to understand what's
 *  going on in this code.
 */

/**
 * Compute a location, given a course and distance from a starting location
 *
 * @param p starting location
 * @param trueCourse_deg direction of movement (degrees)
 * @param d_meters distance to move (meters)
 * @returns new location
 */

export function traverseEllipsoid(
	p: GeodeticCoordinates,
	trueCourse_deg:number,
	d_meters: number): GeodeticCoordinates {

	const course_rad = DEGtoRAD(trueCourse_deg);
	return traverse (p, Math.sin(course_rad), Math.cos(course_rad), d_meters);
}

export function traverse(p: GeodeticCoordinates,
	cos_course: number,
	sin_course: number,
	d_meters: number): GeodeticCoordinates
{
    const res: GeodeticCoordinates = { lat_deg: 0, lon_deg: 0, alt_m: 0};

/*  Increase our height to the height above the WGS-84 reference ellipsoid */

	const    wgs84_a = WGS84_MAJOR + p.alt_m;

	const sin_lat = Math.sin(DEGtoRAD(p.lat_deg));
	const sin_lat_sqr = sin_lat * sin_lat;
	const cos_lat = Math.cos(DEGtoRAD(p.lat_deg));
	const tan_lat = sin_lat / cos_lat;
	const sin_course_sqr = sin_course * sin_course;
	const d_sqr = d_meters * d_meters;

	const n1 = wgs84_a / Math.sqrt(1.0 - WGS84_ECCENTRICITY_SQR * sin_lat_sqr);
	const m1 = (wgs84_a * (1.0 - WGS84_ECCENTRICITY_SQR)) /
		Math.pow(1.0 - WGS84_ECCENTRICITY_SQR * sin_lat_sqr, 1.5);

	const B = 1.0 / m1;

	const h = d_meters * B * cos_course;

	const C = tan_lat / (2.0 * m1 * n1);

	const E = (1.0 + 3.0 * tan_lat * tan_lat) *
		(1.0 - WGS84_ECCENTRICITY_SQR * sin_lat_sqr) / (6.0 * wgs84_a * wgs84_a);

	const delta_latitude = d_meters * B * cos_course -
		d_sqr * C * sin_course_sqr -
		h * d_sqr * E * sin_course_sqr;

	res.lat_deg = RADtoDEG(normalizeLatitude(DEGtoRAD(p.lat_deg) + delta_latitude))

	const sin_newlat = Math.sin(DEGtoRAD(res.lat_deg));

	const n2 = wgs84_a / Math.sqrt(1.0 - WGS84_ECCENTRICITY_SQR * sin_newlat * sin_newlat);

	const delta_longitude = (d_meters * sin_course) / (n2 * Math.cos(DEGtoRAD(p.lat_deg)));

	res.lon_deg = RADtoDEG(normalizeLongitude(DEGtoRAD(p.lon_deg) + delta_longitude))

    return res;
}
