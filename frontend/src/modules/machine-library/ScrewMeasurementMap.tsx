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

const screwSections: Array<{
  key: ScrewSectionKey;
  shortLabel: string;
  x1: number;
  x2: number;
  pillX: number;
  targetX: number;
  color: string;
  fill: string;
}> = [
  { key: 'feed', shortLabel: 'Feed', x1: 260, x2: 520, pillX: 390, targetX: 390, color: '#44d7ff', fill: 'rgba(68,215,255,.105)' },
  { key: 'transition', shortLabel: 'Transition', x1: 520, x2: 820, pillX: 670, targetX: 670, color: '#36e5aa', fill: 'rgba(54,229,170,.095)' },
  { key: 'metering', shortLabel: 'Metering', x1: 820, x2: 1080, pillX: 950, targetX: 950, color: '#ffb339', fill: 'rgba(255,179,57,.105)' },
];

const flightLines = Array.from({ length: 17 }, (_, index) => 270 + index * 48);

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
  if (raw) return raw.length > 13 ? `${raw.slice(0, 13)}…` : raw;
  if (value.valueInches !== null) return `${Number(value.valueInches.toFixed(3))} in`;
  return 'Add Flight';
}

export default function ScrewMeasurementMap({ onAddReading, readings }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div
        aria-label="Flight OD quick-add controls"
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
          Flight OD quick-add
        </span>
        {screwSections.map(section => (
          <button
            className="compact-button"
            type="button"
            key={section.key}
            onClick={() => onAddReading('flight', section.key)}
            aria-label={`Add ${section.shortLabel} Flight OD reading`}
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
            {section.shortLabel}: {compactMeasurementDisplay(latestReading(readings, section.key))}
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
          viewBox="0 0 1200 340"
          role="img"
          aria-labelledby="clean-screw-title clean-screw-desc"
          style={{ display: 'block', width: '100%', height: 'auto', minHeight: 232 }}
        >
          <title id="clean-screw-title">Clean technical screw flight measurement map</title>
          <desc id="clean-screw-desc">
            Clean inspection schematic showing a tapered screw core, flight OD envelope, feed transition and metering zones, and aligned Flight OD callout buttons.
          </desc>
          <defs>
            <linearGradient id="cleanPanel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#092336" />
              <stop offset="0.58" stopColor="#061522" />
              <stop offset="1" stopColor="#02070d" />
            </linearGradient>
            <linearGradient id="cleanCore" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f4fbff" stopOpacity=".95" />
              <stop offset=".35" stopColor="#9fb3bd" stopOpacity=".98" />
              <stop offset=".58" stopColor="#536a75" stopOpacity=".98" />
              <stop offset=".84" stopColor="#d9ecf2" stopOpacity=".94" />
              <stop offset="1" stopColor="#2c414c" stopOpacity=".98" />
            </linearGradient>
            <linearGradient id="cleanFlight" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f8fdff" stopOpacity=".9" />
              <stop offset=".44" stopColor="#aac0ca" stopOpacity=".78" />
              <stop offset="1" stopColor="#f5fbff" stopOpacity=".82" />
            </linearGradient>
            <linearGradient id="cleanDarkSteel" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#263942" />
              <stop offset=".5" stopColor="#b8cbd3" />
              <stop offset="1" stopColor="#4c646e" />
            </linearGradient>
            <filter id="cleanDrop" x="-10%" y="-45%" width="120%" height="190%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#00070d" floodOpacity=".42" />
            </filter>
            <filter id="cleanPillGlow" x="-20%" y="-70%" width="140%" height="240%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#44d7ff" floodOpacity=".18" />
            </filter>
            <clipPath id="flightEnvelopeClip">
              <rect x="260" y="134" width="820" height="114" rx="8" />
            </clipPath>
            <marker id="cleanArrow" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto" viewBox="0 0 8 8">
              <path d="M0 0 L8 4 L0 8 Z" fill="#8fe8ff" />
            </marker>
          </defs>

          <rect x="16" y="14" width="1168" height="312" rx="24" fill="#020b13" stroke="rgba(68,215,255,.24)" strokeWidth="2" />
          <rect x="58" y="88" width="1084" height="154" rx="18" fill="url(#cleanPanel)" stroke="rgba(68,215,255,.22)" />

          <path d="M260 134 H1080 M260 248 H1080" stroke="rgba(180,231,245,.26)" strokeWidth="1.5" strokeDasharray="9 9" />
          {screwSections.map(section => (
            <g key={section.key}>
              <rect x={section.x1} y="104" width={section.x2 - section.x1} height="158" rx="10" fill={section.fill} />
              <line x1={section.x1} y1="96" x2={section.x1} y2="268" stroke="rgba(223,247,255,.16)" strokeDasharray="7 9" />
              <line x1={section.x2} y1="96" x2={section.x2} y2="268" stroke="rgba(223,247,255,.16)" strokeDasharray="7 9" />
              <line x1={section.x1 + 20} y1="262" x2={section.x2 - 20} y2="262" stroke={section.color} strokeWidth="3" strokeLinecap="round" opacity=".7" />
              <text x={(section.x1 + section.x2) / 2} y="302" textAnchor="middle" fill={section.color} fontSize="22" fontWeight="950">{section.shortLabel.toUpperCase()}</text>
            </g>
          ))}

          <g filter="url(#cleanDrop)">
            <rect x="86" y="170" width="84" height="42" rx="9" fill="url(#cleanDarkSteel)" stroke="rgba(238,251,255,.56)" />
            <path d="M104 181 H152 M104 191 H152 M104 201 H152" stroke="#eefbff" strokeWidth="4" strokeLinecap="round" opacity=".68" />
            <rect x="170" y="156" width="44" height="70" rx="9" fill="url(#cleanDarkSteel)" stroke="rgba(238,251,255,.48)" />
            <rect x="214" y="171" width="46" height="40" rx="8" fill="url(#cleanDarkSteel)" stroke="rgba(238,251,255,.36)" />
            <text x="112" y="145" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">DRIVE /</text>
            <text x="112" y="164" textAnchor="middle" fill="#eefbff" fontSize="15" fontWeight="950">SPLINE END</text>

            <g clipPath="url(#flightEnvelopeClip)">
              {flightLines.map(x => (
                <g key={x}>
                  <path d={`M${x} 136 L${x + 66} 246`} stroke="rgba(2,7,13,.58)" strokeWidth="18" strokeLinecap="round" />
                  <path d={`M${x} 136 L${x + 66} 246`} stroke="url(#cleanFlight)" strokeWidth="14" strokeLinecap="round" opacity=".88" />
                  <path d={`M${x - 5} 139 L${x + 60} 240`} stroke="rgba(255,255,255,.55)" strokeWidth="3" strokeLinecap="round" opacity=".82" />
                </g>
              ))}
            </g>

            <path d="M260 187 C382 187 462 187 520 184 C632 180 724 174 820 166 C910 160 996 158 1080 158 L1080 224 C996 224 910 222 820 216 C724 210 632 204 520 200 C462 197 382 197 260 197 Z" fill="url(#cleanCore)" stroke="rgba(238,251,255,.34)" strokeWidth="1.6" />
            <path d="M260 187 C382 187 462 187 520 184 C632 180 724 174 820 166 C910 160 996 158 1080 158" stroke="rgba(255,255,255,.62)" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M260 197 C382 197 462 197 520 200 C632 204 724 210 820 216 C910 222 996 224 1080 224" stroke="rgba(3,8,14,.54)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <path d="M278 192 C452 192 586 191 720 190 C850 189 962 189 1066 188" stroke="rgba(12,24,32,.54)" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity=".62" />

            <rect x="1080" y="138" width="24" height="130" rx="6" fill="url(#cleanDarkSteel)" stroke="rgba(238,251,255,.52)" />
            <line x1="1104" y1="148" x2="1104" y2="258" stroke="rgba(255,255,255,.65)" strokeWidth="2" strokeLinecap="round" />
          </g>

          {screwSections.map(section => {
            const display = compactMeasurementDisplay(latestReading(readings, section.key));
            return (
              <g
                key={`flight-callout-${section.key}`}
                role="button"
                tabIndex={0}
                aria-label={`Add ${section.shortLabel} Flight OD reading`}
                onClick={() => onAddReading('flight', section.key)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onAddReading('flight', section.key);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <path d={`M${section.pillX} 90 C${section.pillX} 110 ${section.targetX} 118 ${section.targetX} 134`} fill="none" stroke={section.color} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="6 7" markerEnd="url(#cleanArrow)" opacity=".86" />
                <circle cx={section.targetX} cy="134" r="7" fill={section.color} opacity=".94" />
                <circle cx={section.targetX} cy="134" r="15" fill="none" stroke={section.color} strokeWidth="1.8" opacity=".42" />
                <rect x={section.pillX - 82} y="38" width="164" height="50" rx="16" fill="rgba(2,14,28,.94)" stroke={section.color} strokeWidth="1.8" filter="url(#cleanPillGlow)" />
                <rect x={section.pillX - 70} y="49" width="140" height="28" rx="11" fill="rgba(255,255,255,.055)" />
                <text x={section.pillX} y="60" textAnchor="middle" fill="#f3fbff" fontSize="11.8" fontWeight="950" letterSpacing=".25">{section.shortLabel.toUpperCase()} FLIGHT OD</text>
                <text x={section.pillX} y="78" textAnchor="middle" fill={section.color} fontSize="14" fontWeight="950">{display}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="screw-diagram-legend" aria-label="Screw visual legend">
        <span className="flight">Flight OD = outside diameter over the flights</span>
        <span className="root">Root Dia will be added after the Flight OD visual is approved</span>
      </div>
    </section>
  );
}
