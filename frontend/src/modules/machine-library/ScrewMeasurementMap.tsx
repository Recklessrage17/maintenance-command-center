type ScrewMeasurementKind = 'flight' | 'root';
type ScrewSectionKey = 'feed' | 'transition' | 'metering';
type MeasurementUnit = 'in' | 'mm';
type MeasurementValue = { rawInput: string; valueInches: number | null; valueMm: number | null; unitDetected: MeasurementUnit | ''; validationMessage: string };
type ScrewMeasurementReading = { id: string; label: string; value: MeasurementValue; notes: string };
type ScrewMeasurementReadings = Record<ScrewMeasurementKind, Record<ScrewSectionKey, ScrewMeasurementReading[]>>;

type ScrewMeasurementMapProps = {
  onAddReading: (kind: ScrewMeasurementKind, section: ScrewSectionKey) => void;
  readings?: ScrewMeasurementReadings;
};

const sectionZones: Array<{
  key: ScrewSectionKey;
  label: string;
  x1: number;
  x2: number;
  color: string;
  fill: string;
}> = [
  { key: 'metering', label: 'METER', x1: 225, x2: 470, color: '#ffb339', fill: 'rgba(255,179,57,.07)' },
  { key: 'transition', label: 'TRANSITION', x1: 470, x2: 765, color: '#36e5aa', fill: 'rgba(54,229,170,.075)' },
  { key: 'feed', label: 'FEED', x1: 765, x2: 1018, color: '#44d7ff', fill: 'rgba(68,215,255,.075)' },
];

const flightRibs = Array.from({ length: 15 }, (_, index) => 238 + index * 54);
const measurementPoints: Array<{ id: string; section: ScrewSectionKey; x: number }> = [
  { id: 'm1', section: 'metering', x: 270 },
  { id: 'm2', section: 'metering', x: 350 },
  { id: 'm3', section: 'metering', x: 430 },
  { id: 't1', section: 'transition', x: 530 },
  { id: 't2', section: 'transition', x: 620 },
  { id: 't3', section: 'transition', x: 710 },
  { id: 'f1', section: 'feed', x: 815 },
  { id: 'f2', section: 'feed', x: 900 },
  { id: 'f3', section: 'feed', x: 985 },
];

function latestReading(readings: ScrewMeasurementReadings | undefined, kind: ScrewMeasurementKind, section: ScrewSectionKey) {
  const sectionReadings = readings?.[kind]?.[section] ?? [];
  return [...sectionReadings].reverse().find(reading => {
    const value = reading.value;
    return Boolean(value.rawInput.trim()) || (value.valueInches !== null && value.valueMm !== null);
  }) ?? sectionReadings[sectionReadings.length - 1];
}

function compactMeasurementDisplay(reading: ScrewMeasurementReading | undefined, emptyLabel: string) {
  if (!reading) return emptyLabel;
  const value = reading.value;
  if (value.validationMessage) return 'Check';
  const raw = value.rawInput.trim();
  if (raw) return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
  if (value.valueInches !== null) return `${Number(value.valueInches.toFixed(3))}`;
  return emptyLabel;
}

function sectionFor(section: ScrewSectionKey) {
  return sectionZones.find(item => item.key === section)!;
}

function rootY(x: number) {
  if (x < 470) return 198;
  if (x < 765) return 192;
  return 184;
}

function flightTopY(x: number) {
  if (x < 470) return 152;
  if (x < 765) return 148;
  return 142;
}

function flightBottomY(x: number) {
  if (x < 470) return 242;
  if (x < 765) return 250;
  return 258;
}

export default function ScrewMeasurementMap({ onAddReading, readings }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div
        aria-label="Screw measurement quick-add controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '7px 9px',
          border: '1px solid rgba(68,215,255,.18)',
          borderRadius: 10,
          background: 'linear-gradient(145deg, rgba(5,22,35,.72), rgba(3,10,18,.54))',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            minHeight: 28,
            alignItems: 'center',
            padding: '0 10px',
            border: '1px solid rgba(68,215,255,.32)',
            borderRadius: 999,
            color: '#bff3ff',
            background: 'rgba(5,61,86,.24)',
            fontSize: '.74rem',
            fontWeight: 950,
          }}
        >
          PDF-style screw map
        </span>
        {sectionZones.map(section => (
          <button
            className="compact-button"
            type="button"
            key={`flight-${section.key}`}
            onClick={() => onAddReading('flight', section.key)}
            aria-label={`Add ${section.label} Flight OD reading`}
            style={{
              minHeight: 30,
              width: 'auto',
              padding: '0 10px',
              border: `1px solid ${section.color}`,
              borderRadius: 999,
              color: '#e8fbff',
              background: 'rgba(4,18,34,.72)',
              fontSize: '.74rem',
              fontWeight: 950,
              cursor: 'pointer',
            }}
          >
            {section.label}: Add Flight
          </button>
        ))}
      </div>

      <div
        className="screw-diagram-wrap"
        style={{
          padding: 0,
          overflow: 'hidden',
          borderColor: 'rgba(68,215,255,.24)',
          background: 'linear-gradient(180deg, rgba(2,12,22,.96), rgba(1,7,13,.98))',
        }}
      >
        <svg
          viewBox="0 0 1200 430"
          role="img"
          aria-labelledby="pdf-screw-title pdf-screw-desc"
          style={{ display: 'block', width: '100%', height: 'auto', minHeight: 290 }}
        >
          <title id="pdf-screw-title">PDF style screw measurement map</title>
          <desc id="pdf-screw-desc">
            Schematic injection screw with a tapered core, helical flights, top root measurement leaders, and bottom flight measurement leaders.
          </desc>
          <defs>
            <linearGradient id="screwCoreSteel" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f7fdff" stopOpacity=".96" />
              <stop offset=".24" stopColor="#b8cbd4" stopOpacity=".96" />
              <stop offset=".48" stopColor="#627985" stopOpacity=".98" />
              <stop offset=".72" stopColor="#e9f5f8" stopOpacity=".92" />
              <stop offset="1" stopColor="#2d444f" stopOpacity=".98" />
            </linearGradient>
            <linearGradient id="screwFlightSteel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".96" />
              <stop offset=".42" stopColor="#9fb5bf" stopOpacity=".92" />
              <stop offset="1" stopColor="#f7fdff" stopOpacity=".86" />
            </linearGradient>
            <linearGradient id="darkSteel" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#263942" />
              <stop offset=".5" stopColor="#b8cbd3" />
              <stop offset="1" stopColor="#4c646e" />
            </linearGradient>
            <filter id="sheetGlow" x="-8%" y="-30%" width="116%" height="160%">
              <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#00070d" floodOpacity=".38" />
            </filter>
            <clipPath id="flightClip">
              <path d="M225 144 C350 144 415 146 470 148 C580 152 660 150 765 142 C850 136 935 134 1018 136 L1018 260 C935 260 850 258 765 258 C660 254 580 248 470 242 C415 240 350 238 225 236 Z" />
            </clipPath>
            <marker id="smallArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" viewBox="0 0 7 7">
              <path d="M0 0 L7 3.5 L0 7 Z" fill="#dff8ff" />
            </marker>
          </defs>

          <rect x="18" y="18" width="1164" height="394" rx="24" fill="#020b13" stroke="rgba(68,215,255,.24)" strokeWidth="2" />
          <rect x="74" y="122" width="1052" height="176" rx="18" fill="rgba(6,22,32,.72)" stroke="rgba(68,215,255,.2)" />

          {sectionZones.map(section => (
            <g key={section.key}>
              <rect x={section.x1} y="122" width={section.x2 - section.x1} height="176" rx="10" fill={section.fill} />
              <line x1={section.x1} y1="112" x2={section.x1} y2="306" stroke="rgba(223,247,255,.16)" strokeDasharray="7 9" />
              <line x1={section.x2} y1="112" x2={section.x2} y2="306" stroke="rgba(223,247,255,.16)" strokeDasharray="7 9" />
              <line x1={section.x1 + 18} y1="310" x2={section.x2 - 18} y2="310" stroke={section.color} strokeWidth="3" strokeLinecap="round" opacity=".72" />
              <text x={(section.x1 + section.x2) / 2} y="358" textAnchor="middle" fill={section.color} fontSize="23" fontWeight="950">{section.label}</text>
              <text x={(section.x1 + section.x2) / 2} y="382" textAnchor="middle" fill="#a9c6d3" fontSize="12" fontWeight="800">Smallest Dia.</text>
            </g>
          ))}

          <g filter="url(#sheetGlow)">
            <text x="106" y="184" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">NOZZLE</text>
            <text x="106" y="204" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">END</text>
            <path d="M126 205 H178 V182 H204 V219 H178 V236 H126 Z" fill="none" stroke="#dff8ff" strokeWidth="3" strokeLinejoin="round" />
            <rect x="204" y="178" width="22" height="64" rx="5" fill="url(#darkSteel)" stroke="rgba(238,251,255,.5)" />

            <g clipPath="url(#flightClip)">
              {flightRibs.map(x => (
                <g key={`rib-${x}`}>
                  <path d={`M${x - 8} 142 L${x + 44} 260`} stroke="rgba(2,7,13,.6)" strokeWidth="18" strokeLinecap="round" />
                  <path d={`M${x - 8} 142 L${x + 44} 260`} stroke="url(#screwFlightSteel)" strokeWidth="13" strokeLinecap="round" opacity=".94" />
                  <path d={`M${x - 14} 147 L${x + 36} 252`} stroke="rgba(255,255,255,.5)" strokeWidth="2.6" strokeLinecap="round" opacity=".8" />
                </g>
              ))}
            </g>

            <path d="M225 194 C350 194 415 193 470 190 C580 184 660 178 765 168 C850 160 935 158 1018 158 L1018 226 C935 226 850 224 765 218 C660 210 580 204 470 200 C415 198 350 198 225 198 Z" fill="url(#screwCoreSteel)" stroke="rgba(238,251,255,.35)" strokeWidth="1.8" />
            <path d="M225 194 C350 194 415 193 470 190 C580 184 660 178 765 168 C850 160 935 158 1018 158" stroke="rgba(255,255,255,.62)" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M225 198 C350 198 415 198 470 200 C580 204 660 210 765 218 C850 224 935 226 1018 226" stroke="rgba(3,8,14,.56)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <path d="M235 196 C390 195 520 194 642 192 C780 190 910 190 1008 190" stroke="rgba(12,24,32,.54)" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity=".58" />

            <path d="M1018 142 H1044 V134 H1066 V250 H1044 V242 H1018 Z" fill="none" stroke="#dff8ff" strokeWidth="3" strokeLinejoin="round" />
            <rect x="1066" y="166" width="68" height="64" rx="8" fill="none" stroke="#dff8ff" strokeWidth="3" />
            <path d="M1078 178 H1122 M1078 190 H1122 M1078 202 H1122 M1078 214 H1122" stroke="#eefbff" strokeWidth="3.5" strokeLinecap="round" opacity=".76" />
            <text x="1102" y="258" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">SPLINE</text>
            <text x="1102" y="277" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">CHECK</text>
          </g>

          <text x="1042" y="112" fill="#f8fdff" fontSize="13" fontWeight="900">Root Measurements</text>
          <text x="1032" y="334" fill="#f8fdff" fontSize="13" fontWeight="900">Flight Measurements</text>

          {measurementPoints.map((point, index) => {
            const section = sectionFor(point.section);
            const rootValue = compactMeasurementDisplay(latestReading(readings, 'root', point.section), 'Root');
            const flightValue = compactMeasurementDisplay(latestReading(readings, 'flight', point.section), 'Flight');
            const topY = 70 + (index % 3) * 12;
            const bottomY = 342 - (index % 3) * 12;
            const rootTargetY = rootY(point.x) - 16;
            const flightTargetY = flightBottomY(point.x) + 10;
            return (
              <g key={`measure-${point.id}`}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Add ${section.label} Root Dia reading`}
                  onClick={() => onAddReading('root', point.section)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onAddReading('root', point.section);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <path d={`M${point.x - 34} ${topY} L${point.x} ${rootTargetY}`} stroke={section.color} strokeWidth="1.5" strokeLinecap="round" markerEnd="url(#smallArrow)" opacity=".86" />
                  <rect x={point.x - 70} y={topY - 16} width="62" height="20" rx="7" fill="rgba(2,14,28,.9)" stroke={section.color} strokeWidth="1.2" />
                  <text x={point.x - 39} y={topY - 2} textAnchor="middle" fill={section.color} fontSize="10.5" fontWeight="900">{rootValue}</text>
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Add ${section.label} Flight OD reading`}
                  onClick={() => onAddReading('flight', point.section)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onAddReading('flight', point.section);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <path d={`M${point.x - 24} ${bottomY} L${point.x} ${flightTargetY}`} stroke={section.color} strokeWidth="1.5" strokeLinecap="round" markerEnd="url(#smallArrow)" opacity=".86" />
                  <rect x={point.x - 62} y={bottomY - 4} width="68" height="20" rx="7" fill="rgba(2,14,28,.9)" stroke={section.color} strokeWidth="1.2" />
                  <text x={point.x - 28} y={bottomY + 10} textAnchor="middle" fill={section.color} fontSize="10.5" fontWeight="900">{flightValue}</text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="screw-diagram-legend" aria-label="Screw visual legend">
        <span className="root">Top lines = Root Dia measurement points</span>
        <span className="flight">Bottom lines = Flight OD measurement points</span>
      </div>
    </section>
  );
}
