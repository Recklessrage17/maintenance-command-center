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
  label: string;
  shortLabel: string;
  zoneLabel: string;
  x1: number;
  x2: number;
  pillX: number;
  targetX: number;
  color: string;
  dimColor: string;
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', zoneLabel: 'Rear / Feed', x1: 260, x2: 520, pillX: 365, targetX: 375, color: '#44d7ff', dimColor: 'rgba(68,215,255,.16)' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', zoneLabel: 'Compression / Taper', x1: 520, x2: 820, pillX: 640, targetX: 665, color: '#36e5aa', dimColor: 'rgba(54,229,170,.14)' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', zoneLabel: 'Front / Metering', x1: 820, x2: 1080, pillX: 925, targetX: 940, color: '#ffb339', dimColor: 'rgba(255,179,57,.15)' },
];

const flightBands = Array.from({ length: 16 }, (_, index) => 278 + index * 49);

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
          background: 'linear-gradient(180deg, rgba(2,12,22,.95), rgba(1,7,13,.96))',
        }}
      >
        <svg
          viewBox="0 0 1200 420"
          role="img"
          aria-labelledby="code-built-screw-title code-built-screw-desc"
          style={{ display: 'block', width: '100%', height: 'auto', minHeight: 260 }}
        >
          <title id="code-built-screw-title">Code-built screw flight measurement map</title>
          <desc id="code-built-screw-desc">
            Interactive coded screw map showing drive spline end, feed, transition, and metering zones, with Flight OD callout pills and arrow leaders.
          </desc>
          <defs>
            <linearGradient id="codedPanel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#0b2638" />
              <stop offset="0.52" stopColor="#061522" />
              <stop offset="1" stopColor="#02070d" />
            </linearGradient>
            <linearGradient id="codedSteel" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f7fdff" stopOpacity=".96" />
              <stop offset=".22" stopColor="#c6d7de" stopOpacity=".98" />
              <stop offset=".48" stopColor="#6f8791" stopOpacity=".98" />
              <stop offset=".72" stopColor="#e5f2f6" stopOpacity=".92" />
              <stop offset="1" stopColor="#273b45" stopOpacity=".98" />
            </linearGradient>
            <linearGradient id="codedFlight" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
              <stop offset=".36" stopColor="#bfd0d7" stopOpacity=".96" />
              <stop offset=".72" stopColor="#5f7680" stopOpacity=".96" />
              <stop offset="1" stopColor="#f0fbff" stopOpacity=".9" />
            </linearGradient>
            <linearGradient id="codedDarkSteel" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#24353d" />
              <stop offset=".45" stopColor="#b9cbd2" />
              <stop offset="1" stopColor="#465d66" />
            </linearGradient>
            <filter id="codedScrewShadow" x="-10%" y="-40%" width="120%" height="180%">
              <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#00070d" floodOpacity=".45" />
            </filter>
            <filter id="codedPillGlow" x="-20%" y="-70%" width="140%" height="240%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#44d7ff" floodOpacity=".22" />
            </filter>
            <clipPath id="codedFlightClip">
              <path d="M260 146 H1080 V246 H260 Z" />
            </clipPath>
            <marker id="codedArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" viewBox="0 0 10 10">
              <path d="M0 0 L10 5 L0 10 Z" fill="#8fe8ff" />
            </marker>
          </defs>

          <rect x="14" y="16" width="1172" height="388" rx="24" fill="#020b13" stroke="rgba(68,215,255,.24)" strokeWidth="2" />
          <rect x="50" y="76" width="1100" height="246" rx="18" fill="url(#codedPanel)" stroke="rgba(68,215,255,.2)" />

          {screwSections.map(section => (
            <g key={section.key}>
              <rect x={section.x1} y="108" width={section.x2 - section.x1} height="170" rx="10" fill={section.dimColor} />
              <line x1={section.x1} y1="92" x2={section.x1} y2="292" stroke="rgba(223,247,255,.18)" strokeDasharray="7 8" />
              <line x1={section.x2} y1="92" x2={section.x2} y2="292" stroke="rgba(223,247,255,.18)" strokeDasharray="7 8" />
              <line x1={section.x1 + 20} y1="292" x2={section.x2 - 20} y2="292" stroke={section.color} strokeWidth="3" strokeLinecap="round" opacity=".6" />
              <text x={(section.x1 + section.x2) / 2} y="336" textAnchor="middle" fill={section.color} fontSize="26" fontWeight="950">{section.shortLabel.toUpperCase()}</text>
              <text x={(section.x1 + section.x2) / 2} y="360" textAnchor="middle" fill="#a8c7d5" fontSize="14" fontWeight="850">{section.zoneLabel}</text>
            </g>
          ))}

          <g filter="url(#codedScrewShadow)">
            <text x="96" y="154" textAnchor="middle" fill="#eefbff" fontSize="16" fontWeight="950">DRIVE /</text>
            <text x="96" y="174" textAnchor="middle" fill="#eefbff" fontSize="16" fontWeight="950">SPLINE END</text>
            <rect x="72" y="184" width="84" height="48" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.54)" />
            <path d="M86 196 H142 M86 208 H142 M86 220 H142" fill="none" stroke="#eefbff" strokeWidth="5" strokeLinecap="round" opacity=".68" />
            <rect x="156" y="168" width="46" height="80" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.5)" />
            <rect x="202" y="182" width="56" height="52" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.42)" />

            <path d="M258 184 C378 184 464 185 520 190 C640 202 724 184 820 160 H1080 V226 H820 C724 208 640 204 520 214 C464 220 378 220 258 220 Z" fill="url(#codedSteel)" stroke="rgba(238,251,255,.3)" strokeWidth="1.5" />
            <path d="M258 184 C378 184 464 185 520 190 C640 202 724 184 820 160 H1080" fill="none" stroke="rgba(255,255,255,.52)" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M258 220 C378 220 464 220 520 214 C640 204 724 208 820 226 H1080" fill="none" stroke="rgba(2,7,13,.48)" strokeWidth="4" strokeLinecap="round" />

            <g clipPath="url(#codedFlightClip)">
              {flightBands.map(x => (
                <g key={x}>
                  <path d={`M${x + 25} 148 L${x + 82} 246`} stroke="rgba(2,7,13,.58)" strokeWidth="8" strokeLinecap="round" />
                  <path d={`M${x} 146 H${x + 34} L${x + 96} 246 H${x + 62} Z`} fill="url(#codedFlight)" stroke="rgba(247,253,255,.72)" strokeWidth="1.3" />
                  <path d={`M${x + 34} 151 L${x + 92} 240`} stroke="rgba(255,255,255,.5)" strokeWidth="2" strokeLinecap="round" />
                </g>
              ))}
            </g>
            <rect x="1080" y="148" width="26" height="100" rx="5" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.52)" />
            <line x1="1106" y1="156" x2="1106" y2="240" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" strokeLinecap="round" />
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
                <path d={`M${section.pillX} 94 C${section.pillX} 122 ${section.targetX - 24} 132 ${section.targetX} 148`} fill="none" stroke={section.color} strokeWidth="3" strokeLinecap="round" strokeDasharray="8 7" markerEnd="url(#codedArrow)" opacity=".92" />
                <circle cx={section.targetX} cy="148" r="9" fill={section.color} opacity=".95" />
                <circle cx={section.targetX} cy="148" r="18" fill="none" stroke={section.color} strokeWidth="2" opacity=".46" />
                <rect x={section.pillX - 92} y="30" width="184" height="62" rx="18" fill="rgba(2,14,28,.94)" stroke={section.color} strokeWidth="2" filter="url(#codedPillGlow)" />
                <rect x={section.pillX - 80} y="41" width="160" height="40" rx="13" fill={section.dimColor} />
                <text x={section.pillX} y="56" textAnchor="middle" fill="#f3fbff" fontSize="13" fontWeight="950" letterSpacing=".4">{section.shortLabel.toUpperCase()} FLIGHT OD</text>
                <text x={section.pillX} y="76" textAnchor="middle" fill={section.color} fontSize="15" fontWeight="950">{display}</text>
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
