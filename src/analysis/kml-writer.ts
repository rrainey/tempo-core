
import stream, { Stream } from 'stream';
import { DropkickReader, GeodeticCoordinates, Vector3, KMLDataV1 } from './dropkick-reader';
//import { enUS } from '@mui/x-date-pickers';

export class KMLWriter {

    generate(name:string, snippet:string, begin:Date, end:Date, records:KMLDataV1[]) {
        let center: GeodeticCoordinates;
        if (records[0].location ) {
          center = records[0].location;
        }
        else {
          center = { lat_deg: 0, lon_deg: 0, alt_m: 0 };
        }
        return this.header(name, snippet, begin, end, center) +
            this.folder(records) +
            this.end();
    }

    header (name:string, snippet:string, begin:Date, end:Date, centerOfInterest: GeodeticCoordinates) {
      return `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
    <Document>
      <name>` + name +`</name>
      <Snippet>` + snippet + `</Snippet>
      <!-- Normal track style -->
      <LookAt>
        <gx:TimeSpan>
          <begin>` + begin.toISOString() + `</begin>
          <end>` + end.toISOString() + `</end>
        </gx:TimeSpan>
        <longitude>` + centerOfInterest.lon_deg + `</longitude>
        <latitude> ` + centerOfInterest.lat_deg + `</latitude>
        <range>1000.0</range>
      </LookAt>
      <Style id="track_n">
        <IconStyle>
          <scale>.5</scale>
          <Icon>
            <href>/images/track-none.png</href>
          </Icon>
        </IconStyle>
        <LabelStyle>
          <scale>0</scale>
        </LabelStyle>
      </Style>
      <!-- Highlighted track style -->
      <Style id="track_h">
        <IconStyle>
          <scale>1.2</scale>
          <Icon>
            <href>/images/track-none.png</href>
          </Icon>
        </IconStyle>
      </Style>
      <StyleMap id="track">
        <Pair>
          <key>normal</key>
          <styleUrl>#track_n</styleUrl>
        </Pair>
        <Pair>
          <key>highlight</key>
          <styleUrl>#track_h</styleUrl>
        </Pair>
      </StyleMap>
      <!-- Normal multiTrack style -->
      <Style id="multiTrack_n">
        <IconStyle>
          <Icon>
            <href>/images/track-none.png</href>
          </Icon>
        </IconStyle>
        <LineStyle>
          <color>99ffac59</color>
          <width>5</width>
        </LineStyle>
      </Style>
      <!-- Highlighted multiTrack style -->
      <Style id="multiTrack_h">
        <IconStyle>
          <scale>1.2</scale>
          <Icon>
            <href>/images/track-none.png</href>
          </Icon>
        </IconStyle>
        <LineStyle>
          <color>99811b94</color>
          <width>7</width>
        </LineStyle>
      </Style>
      <StyleMap id="multiTrack">
        <Pair>
          <key>normal</key>
          <styleUrl>#multiTrack_n</styleUrl>
        </Pair>
        <Pair>
          <key>highlight</key>
          <styleUrl>#multiTrack_h</styleUrl>
        </Pair>
      </StyleMap>
      <Style id="lineStyle">
        <LineStyle>
          <color>99b9263b</color>
          <width>5</width>
        </LineStyle>
      </Style>
      <Schema id="schema">
        <gx:SimpleArrayField name="baroAlt_ft" type="float">
          <displayName>Barometric Altitude (ft, MSL)</displayName>
        </gx:SimpleArrayField>
        <gx:SimpleArrayField name="groundspeed_kts" type="float">
          <displayName>Groundspeed (kts)</displayName>
        </gx:SimpleArrayField>
        <gx:SimpleArrayField name="track_degTrue" type="float">
          <displayName>Groundtrack (deg, True)</displayName>
        </gx:SimpleArrayField>
      </Schema>
      `; };

    folder( records:KMLDataV1[] ): string {

      //console.count(JSON.stringify(records.map((s) => { return "            <when>" + s.timestamp?.toUTCString() + "</when>\n" })));

      const res =
      `<Folder>
        <name>Tracks</name>
        <Placemark>
          <name>Jump</name>
          <styleUrl>#multiTrack</styleUrl>
          <gx:Track>
          <altitudeMode>absolute</altitudeMode>` +
          records.map((s) => { return "<when>" + s.timestamp?.toISOString() + "</when>" }).join('') +
          records.map((s) => { return "<gx:coord>" + s.location?.lon_deg + " " + s.location?.lat_deg + " " + s.location?.alt_m + "</gx:coord>" }).join('')

//            <when>2010-05-28T02:02:56Z</when>
//            <gx:coord>-122.207881 37.371915 156.000000</gx:coord>

            + "            <ExtendedData>\n              <SchemaData schemaUrl=\"#schema\">\n"+

            "               <gx:SimpleArrayData name=\"baroAlt_ft\">\n" +
            records.map((s) => { return "                  <gx:value>" + s.baroAlt_ft + "</gx:value>\n" }).join('')+
            "               </gx:SimpleArrayData>\n" +

            "               <gx:SimpleArrayData name=\"groundspeed_kts\">\n" +
            records.map((s) => { return "                  <gx:value>" + (((s.groundspeed_kmph ?? 0) * 0.539957)) + "</gx:value>\n" }).join('') +
            "               </gx:SimpleArrayData>\n" +

            "               <gx:SimpleArrayData name=\"track_degTrue\">\n" +
            records.map((s) => { return "                  <gx:value>" + s.groundtrack_degT + "</gx:value>\n" }).join('') +
            "               </gx:SimpleArrayData>\n" +
              `
              </SchemaData>
            </ExtendedData>
          </gx:Track>
        </Placemark>
      </Folder>`;

      return res;
    }

    end() {
        return `
    </Document>
  </kml>`;

      };

    }
