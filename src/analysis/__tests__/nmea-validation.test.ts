// Sentence-level ingestion hygiene: NMEA-0183 resync on interior '$' and
// strict checksum validation. The corrupt fixtures are verbatim lines from a
// real log (test-data/09-formation-20260703-2way/riley) where the firmware's
// write-behind buffer truncated a $PIMU mid-value and fused the next $PIM2
// onto the same line — the parsed timestamp landed in an accel field and
// produced a 675,476 m/s² "acceleration".

import { splitNmeaLine, hasValidNmeaChecksum } from '../nmea-hygiene';

// Known-good lines lifted from real logs.
const GOOD_PIMU = '$PIMU,804013,0.18,7.94,-5.06,-0.1444,-1.1522,0.6171*0F';
const GOOD_GGA = '$GNGGA,150820.00,3326.99826,N,09622.63986,W,1,12,0.59,225.6,M,-25.6,M,,*7B';

// Verbatim corruption from the 09/riley log.
const FUSED_1 = '$PIMU,1291761,-$PIM2,1291761,0.6372,-0.3630,-0.5376,-0.4165*5B';
const FUSED_2 = '$PIMU,1350950,-9$PIM2,1350950,0.1934,-0.7334,0.0260,-0.6514*7F';

describe('splitNmeaLine', () => {
  it('passes a normal sentence through untouched', () => {
    expect(splitNmeaLine(GOOD_PIMU)).toEqual([GOOD_PIMU]);
  });

  it('resyncs on an interior $ — truncated head and intact tail separate', () => {
    expect(splitNmeaLine(FUSED_2)).toEqual([
      '$PIMU,1350950,-9',
      '$PIM2,1350950,0.1934,-0.7334,0.0260,-0.6514*7F',
    ]);
    expect(splitNmeaLine(FUSED_1)).toEqual([
      '$PIMU,1291761,-',
      '$PIM2,1291761,0.6372,-0.3630,-0.5376,-0.4165*5B',
    ]);
  });

  it('ignores junk before the first $ and empty fragments', () => {
    expect(splitNmeaLine('garbage$PIMU,1,2*33')).toEqual(['$PIMU,1,2*33']);
    expect(splitNmeaLine('')).toEqual([]);
    expect(splitNmeaLine('no sentence here')).toEqual([]);
  });
});

describe('hasValidNmeaChecksum', () => {
  it('accepts known-good sentences from real logs', () => {
    expect(hasValidNmeaChecksum(GOOD_PIMU)).toBe(true);
    expect(hasValidNmeaChecksum(GOOD_GGA)).toBe(true);
  });

  it('rejects the truncated heads (no checksum at all)', () => {
    expect(hasValidNmeaChecksum('$PIMU,1350950,-9')).toBe(false);
    expect(hasValidNmeaChecksum('$PIMU,1291761,-')).toBe(false);
  });

  it('recovers the intact tails of the fused lines', () => {
    const [, tail1] = splitNmeaLine(FUSED_1);
    const [, tail2] = splitNmeaLine(FUSED_2);
    expect(hasValidNmeaChecksum(tail1)).toBe(true);
    expect(hasValidNmeaChecksum(tail2)).toBe(true);
  });

  it('rejects the fused lines taken whole (checksum cannot match)', () => {
    expect(hasValidNmeaChecksum(FUSED_1)).toBe(false);
    expect(hasValidNmeaChecksum(FUSED_2)).toBe(false);
  });

  it('rejects a corrupted digit', () => {
    expect(hasValidNmeaChecksum(GOOD_PIMU.replace('7.94', '7.95'))).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(hasValidNmeaChecksum('$PIMU,1,2*3')).toBe(false); // 1-digit checksum
    expect(hasValidNmeaChecksum('PIMU,1,2*33')).toBe(false); // no $
    expect(hasValidNmeaChecksum('$*00')).toBe(false); // empty body
  });
});
