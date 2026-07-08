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
  { key: 'metering', label: 'METER', x1: 190, x2: 455, color: '#ffb339', fill: 'rgba(255,179,57,.08)' },
  { key: 'transition', label: 'TRANSITION', x1: 455, x2: 745, color: '#36e5aa', fill: 'rgba(54,229,170,.08)' },
  { key: 'feed', label: 'FEED', x1: 745, x2: 1015, color: '#44d7ff', fill: 'rgba(68,215,255,.08)' },
];

const measurementPoints: Array<{
  id: string;
  section: ScrewSectionKey;
  rootX: number;
  flightX: number;
}> = [
  { id: 'm1', section: 'metering', rootX: 226, flightX: 220 },
  { id: 'm2', section: 'metering', rootX: 288, flightX: 282 },
  { id: 'm3', section: 'metering', rootX: 350, flightX: 344 },
  { id: 'm4', section: 'metering', rootX: 412, flightX: 406 },
  { id: 't1', section: 'transition', rootX: 490, flightX: 484 },
  { id: 't2', section: 'transition', rootX: 552, flightX: 546 },
  { id: 't3', section: 'transition', rootX: 614, flightX: 608 },
  { id: 't4', section: 'transition', rootX: 676, flightX: 670 },
  { id: 'f1', section: 'feed', rootX: 775, flightX: 768 },
  { id: 'f2', section: 'feed', rootX: 837, flightX: 830 },
  { id: 'f3', section: 'feed', rootX: 899, flightX: 892 },
  { id: 'f4', section: 'feed', rootX: 961, flightX: 954 },
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

function pointY(x: number, kind: ScrewMeasurementKind) {
  if (kind === 'root') {
    if (x < 455) return 174;
    if (x < 745) return 168;
    return 160;
  }
  if (x < 455) return 214;
  if (x < 745) return 224;
  return 232;
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
          PDF-style measurement map
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
            Schematic screw measurement map modeled after the JBT screw and barrel measurement sheet, with top root measurement lines and bottom flight measurement lines.
          </desc>
          <defs>
            <linearGradient id="paperLine" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f2fbff" stopOpacity=".98" />
              <stop offset="1" stopColor="#83a1ac" stopOpacity=".92" />
            </linearGradient>
            <filter id="sheetGlow" x="-8%" y="-30%" width="116%" height="160%">
              <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#00070d" floodOpacity=".38" />
            </filter>
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
            <path d="M126 205 H174 V181 H192 V214 H174 V230 H126 Z" fill="none" stroke="url(#paperLine)" strokeWidth="3" strokeLinejoin="round" />

            <path d="M190 168 L1018 154 L1018 244 L190 232 Z" fill="rgba(220,247,255,.035)" stroke="url(#paperLine)" strokeWidth="3" strokeLinejoin="round" />
            <path d="M190 184 L1018 168 M190 216 L1018 226" stroke="rgba(223,247,255,.5)" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M190 200 C365 198 520 194 670 188 C804 182 915 178 1018 176" stroke="rgba(223,247,255,.48)" strokeWidth="1.5" strokeDasharray="10 8" />

            {measurementPoints.map(point => {
              const yTop = pointY(point.rootX, 'root');
              const yBottom = pointY(point.flightX, 'flight');
              return (
                <g key={`thread-${point.id}`}>
                  <path d={`M${point.flightX - 10} ${yBottom + 18} L${point.flightX + 22} ${yTop - 18}`} stroke="#eefbff" strokeWidth="6" strokeLinecap="round" />
                  <path d={`M${point.flightX - 10} ${yBottom + 18} L${point.flightX + 22} ${yTop - 18}`} stroke="#06131d" strokeWidth="2" strokeLinecap="round" opacity=".45" />
                </g>
              );
            })}

            <path d="M1018 152 H1044 V144 H1066 V254 H1044 V246 H1018 Z" fill="none" stroke="url(#paperLine)" strokeWidth="3" strokeLinejoin="round" />
            <rect x="1066" y="168" width="68" height="64" rx="8" fill="none" stroke="url(#paperLine)" strokeWidth="3" />
            <path d="M1078 180 H1122 M1078 192 H1122 M1078 204 H1122 M1078 216 H1122" stroke="#eefbff" strokeWidth="3.5" strokeLinecap="round" opacity=".76" />
            <text x="1102" y="258" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">SPLINE</text>
            <text x="1102" y="277" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">CHECK</text>
          </g>

          <text x="1060" y="116" fill="#f8fdff" fontSize="13" fontWeight="900">Root Measurements</text>
          <text x="1060" y="332" fill="#f8fdff" fontSize="13" fontWeight="900">Flight Measurements</text>

          {measurementPoints.map((point, index) => {
            const rootY = pointY(point.rootX, 'root');
            const flightY = pointY(point.flightX, 'flight');
            const section = sectionZones.find(item => item.key === point.section)!;
            const rootValue = compactMeasurementDisplay(latestReading(readings, 'root', point.section), 'Root');
            const flightValue = compactMeasurementDisplay(latestReading(readings, 'flight', point.section), 'Flight');
            const topX = point.rootX - 52;
            const bottomX = point.flightX - 46;
            const topY = 62 + (index % 2) * 14;
            const bottomY = 356 - (index % 2) * 14;
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
                  <path d={`M${topX} ${topY} L${point.rootX} ${rootY - 12}`} stroke={section.color} strokeWidth="1.6" strokeLinecap="round" markerEnd="url(#smallArrow)" opacity=".88" />
                  <rect x={topX - 36} y={topY - 16} width="72" height="20" rx="7" fill="rgba(2,14,28,.92)" stroke={section.color} strokeWidth="1.2" />
                  <text x={topX} y={topY - 2} textAnchor="middle" fill={section.color} fontSize="10.5" fontWeight="900">{rootValue}</text>
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
                  <path d={`M${bottomX} ${bottomY} L${point.flightX} ${flightY + 16}`} stroke={section.color} strokeWidth="1.6" strokeLinecap="round" markerEnd="url(#smallArrow)" opacity=".88" />
                  <rect x={bottomX - 38} y={bottomY - 4} width="76" height="20" rx="7" fill="rgba(2,14,28,.92)" stroke={section.color} strokeWidth="1.2" />
                  <text x={bottomX} y={bottomY + 10} textAnchor="middle" fill={section.color} fontSize="10.5" fontWeight="900">{flightValue}</text>
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
