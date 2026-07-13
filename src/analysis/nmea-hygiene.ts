// analysis/nmea-hygiene.ts
//
// Sentence-level ingestion hygiene, dependency-free so it is trivially
// testable and reusable outside the reader.

/**
 * NMEA-0183 resync: '$' is the reserved start-of-sentence delimiter and is
 * illegal inside a sentence body, so each interior '$' begins a new candidate
 * sentence and orphans whatever preceded it. Recovers the intact tail
 * sentence from lines where a truncated write fused two sentences together,
 * e.g. "$PIMU,1350950,-9$PIM2,...*7F" → ["$PIMU,1350950,-9", "$PIM2,...*7F"].
 */
export function splitNmeaLine(line: string): string[] {
	const out: string[] = [];
	let start = line.indexOf('$');
	while (start !== -1) {
		let next = line.indexOf('$', start + 1);
		if (next === -1) next = line.length;
		const candidate = line.slice(start, next).trim();
		if (candidate.length > 1) out.push(candidate);
		start = next === line.length ? -1 : next;
	}
	return out;
}

/**
 * Strict NMEA-0183 checksum validation: sentence must be "$<body>*HH" with a
 * non-empty body free of '$'/'*', and HH must equal the XOR of the body's
 * character codes. Anything else — no checksum, truncated tail, corrupted
 * content — is rejected.
 */
export function hasValidNmeaChecksum(sentence: string): boolean {
	const m = /^\$([^$*]+)\*([0-9A-Fa-f]{2})$/.exec(sentence.trim());
	if (!m) return false;
	const body = m[1];
	let checksum = 0;
	for (let i = 0; i < body.length; i++) {
		checksum ^= body.charCodeAt(i);
	}
	return checksum === parseInt(m[2], 16);
}
