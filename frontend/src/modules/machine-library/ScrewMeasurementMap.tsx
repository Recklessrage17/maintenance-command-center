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

const screwMapSections: Array<{
  key: ScrewSectionKey;
  label: string;
  shortLabel: string;
  accent: 'feed' | 'transition' | 'metering';
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', accent: 'feed' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', accent: 'transition' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', accent: 'metering' },
];

const flightBands = [286, 344, 402, 460, 518, 576, 634, 692, 750, 808, 866, 924, 982, 1040, 1098];

const flightCallouts: Array<{
  key: ScrewSectionKey;
  label: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  color: string;
  glow: string;
}> = [
  { key: 'feed', label: 'Feed', x: 242, y: 26, targetX: 374, targetY: 88, color: '#44d7ff', glow: 'rgba(68,215,255,.28)' },
  { key: 'transition', label: 'Transition', x: 512, y: 26, targetX: 650, targetY: 88, color: '#36e5aa', glow: 'rgba(54,229,170,.26)' },
  { key: 'metering', label: 'Metering', x: 792, y: 26, targetX: 910, targetY: 88, color: '#ffb339', glow: 'rgba(255,179,57,.26)' },
];

function latestReading(readings: ScrewMeasurementReadings | undefined, section: ScrewSectionKey) {
  const sectionReadings = readings?.flight?.[section] ?? [];
  return [...sectionReadings].reverse().find(reading => {
    const value = reading.value;
    return Boolean(value.rawInput.trim()) || (value.valueInches !== null && value.valueMm !== null);
  }) ?? sectionReadings[sectionReadings.length - 1];
}

function compactMeasurementDisplay(reading: ScrewMeasurementReading | undefined) {
  if (!reading) return 'Add Flight';
  const value = reading.value;
  if (value.validationMessage) return 'Check input';
  const raw = value.rawInput.trim();
  if (raw) return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
  if (value.valueInches !== null) return `${Number(value.valueInches.toFixed(3))} in`;
  return 'Add Flight';
}

export default function ScrewMeasurementMap({ onAddReading, readings }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div className="screw-diagram-legend" aria-label="Flight OD quick add controls" style={{ justifyContent: 'space-between', gap: 10 }}>
        <span className="flight">Flight OD quick-add</span>
        {screwMapSections.map(section => (
          <button
            className="screw-diagram-pill flight"
            type="button"
            key={section.key}
            onClick={() => onAddReading('flight', section.key)}
            aria-label={`Add ${section.shortLabel} Flight OD reading`}
            style={{ minHeight: 34, gridTemplateColumns: '22px minmax(0, 1fr)', flex: '0 1 190px', padding: '4px 10px' }}
          >
            <span className="screw-diagram-target-icon" aria-hidden="true" style={{ width: 16, height: 16 }} />
            <span className="screw-diagram-button-copy"><span>{section.shortLabel}</span><span>{compactMeasurementDisplay(latestReading(readings, section.key))}</span></span>
          </button>
        ))}
      </div>

      <div className="screw-diagram-wrap">
        <svg
          className="screw-diagram-svg"
          viewBox="0 0 1100 360"
          role="img"
          aria-labelledby="screw-map-title screw-map-desc"
        >
          <title id="screw-map-title">Visual screw measurement map</title>
          <desc id="screw-map-desc">
            Screw reference map with spline end, feed, transition, and metering zones. Compact callout pills show Flight OD readings and point to the screw flight area.
          </desc>
          <defs>
            <linearGradient id="screwPanelFill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#0b2a3a" />
              <stop offset="0.55" stopColor="#061723" />
              <stop offset="1" stopColor="#02080d" />
            </linearGradient>
            <linearGradient id="screwBodyFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#eef9ff" stopOpacity="0.92" />
              <stop offset="0.34" stopColor="#b8cbd3" stopOpacity="0.96" />
              <stop offset="0.58" stopColor="#7f969f" stopOpacity="0.98" />
              <stop offset="1" stopColor="#24343d" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwFlightFill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f8fdff" stopOpacity="0.9" />
              <stop offset="0.42" stopColor="#b6c8cf" stopOpacity="0.95" />
              <stop offset="1" stopColor="#34444c" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwCapFill" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#394b54" />
              <stop offset="0.5" stopColor="#b8ccd4" />
              <stop offset="1" stopColor="#5d727b" />
            </linearGradient>
            <filter id="screwSoftShadow" x="-10%" y="-35%" width="120%" height="170%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#00070d" floodOpacity="0.38" />
            </filter>
            <clipPath id="screwFlightClip">
              <rect x="204" y="86" width="812" height="128" rx="5" />
            </clipPath>
          </defs>

          <rect x="8" y="8" width="1084" height="344" rx="20" fill="#030d17" stroke="#18506a" strokeWidth="2" />
          <rect x="62" y="70" width="990" height="202" rx="16" fill="url(#screwPanelFill)" stroke="#174b62" strokeWidth="1.5" />

          <rect className="screw-zone-fill feed" x="204" y="86" width="286" height="128" rx="5" />
          <rect className="screw-zone-fill transition" x="490" y="86" width="288" height="128" rx="5" />
          <rect className="screw-zone-fill metering" x="778" y="86" width="238" height="128" rx="5" />
          <path className="screw-zone-divider" d="M490 64 V232 M778 64 V232" />
          <path className="screw-od-envelope" d="M204 86 H1016 M204 214 H1016" />

          {flightCallouts.map(callout => {
            const displayValue = compactMeasurementDisplay(latestReading(readings, callout.key));
            return (
              <g
                key={callout.key}
                role="button"
                tabIndex={0}
                onClick={() => onAddReading('flight', callout.key)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onAddReading('flight', callout.key);
                  }
                }}
                style={{ cursor: 'pointer' }}
                aria-label={`Add ${callout.label} Flight OD reading`}
              >
                <path
                  d={`M${callout.x + 78} ${callout.y + 48} C${callout.x + 92} ${callout.y + 70}, ${callout.targetX - 18} ${callout.targetY - 34}, ${callout.targetX} ${callout.targetY}`}
                  fill="none"
                  stroke={callout.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="7 7"
                  opacity="0.82"
                />
                <circle cx={callout.targetX} cy={callout.targetY} r="8" fill={callout.color} opacity="0.95" />
                <circle cx={callout.targetX} cy={callout.targetY} r="15" fill="none" stroke={callout.color} strokeWidth="2" opacity="0.55" />
                <rect
                  x={callout.x}
                  y={callout.y}
                  width="156"
                  height="48"
                  rx="15"
                  fill="rgba(2,14,28,.94)"
                  stroke={callout.color}
                  strokeWidth="1.6"
                  opacity="0.98"
                />
                <rect x={callout.x + 8} y={callout.y + 7} width="140" height="34" rx="11" fill={callout.glow} opacity="0.48" />
                <text x={callout.x + 78} y={callout.y + 20} textAnchor="middle" fill="#f3fbff" fontSize="12" fontWeight="950">
                  <tspan>{callout.label.toUpperCase()} FLIGHT OD</tspan>
                  <tspan x={callout.x + 78} dy="16" fill={callout.color} fontSize="13">{displayValue}</tspan>
                </text>
              </g>
            );
          })}

          <g className="screw-side-label" filter="url(#screwSoftShadow)">
            <text x="94" y="122" textAnchor="middle">DRIVE /</text>
            <text x="94" y="144" textAnchor="middle">SPLINE END</text>
            <rect className="screw-drive-shank" x="72" y="152" width="84" height="44" rx="8" />
            <path className="screw-spline-groove" d="M85 163 H143 M85 174 H143 M85 185 H143" />
            <rect className="screw-drive-collar" x="156" y="138" width="42" height="72" rx="7" />
            <rect className="screw-shoulder-ring" x="198" y="150" width="28" height="48" rx="6" />
          </g>

          <g filter="url(#screwSoftShadow)">
            <path className="screw-root-core" d="M226 136 C350 136 452 137 490 140 C610 148 694 138 778 116 H1016 V182 H778 C694 164 610 160 490 168 C452 172 350 172 226 172 Z" />
            <path className="screw-root-highlight" d="M226 136 C350 136 452 137 490 140 C610 148 694 138 778 116 H1016" />
            <path className="screw-root-shadow" d="M226 172 C350 172 452 172 490 168 C610 160 694 164 778 182 H1016" />
            <path className="screw-root-edge" d="M226 155 C350 155 452 156 490 157 C610 160 694 152 778 138 H1013" />
            <g clipPath="url(#screwFlightClip)">
              {flightBands.map(x => (
                <g key={x}>
                  <path className="screw-flight-shadow" d={`M${x + 28} 90 L${x + 82} 210`} />
                  <path className="screw-flight-band" d={`M${x} 86 H${x + 30} L${x + 90} 214 H${x + 60} Z`} />
                  <path className="screw-flight-rim" d={`M${x + 30} 90 L${x + 88} 210`} />
                </g>
              ))}
            </g>
            <rect className="screw-flat-end" x="1016" y="88" width="22" height="124" rx="3" />
            <path className="screw-flat-face" d="M1038 94 V206" />
          </g>

          <g className="screw-section-caption feed">
            <text x="347" y="304">FEED</text>
            <text x="347" y="326">rear screw section</text>
          </g>
          <g className="screw-section-caption transition">
            <text x="634" y="304">TRANSITION</text>
            <text x="634" y="326">compression / taper section</text>
          </g>
          <g className="screw-section-caption metering">
            <text x="897" y="304">METERING</text>
            <text x="897" y="326">front discharge section</text>
          </g>
        </svg>
      </div>

      <div className="screw-diagram-legend" aria-label="Screw visual legend">
        <span className="flight">Flight OD = outside diameter over the flights</span>
        <span className="root">Root Dia layout will match this after Flight is approved</span>
      </div>
    </section>
  );
}
