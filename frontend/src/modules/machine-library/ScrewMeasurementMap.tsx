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
  x1: number;
  x2: number;
  pillX: number;
  targetX: number;
  color: string;
  dimColor: string;
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', x1: 260, x2: 520, pillX: 390, targetX: 390, color: '#44d7ff', dimColor: 'rgba(68,215,255,.13)' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', x1: 520, x2: 820, pillX: 670, targetX: 670, color: '#36e5aa', dimColor: 'rgba(54,229,170,.12)' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', x1: 820, x2: 1080, pillX: 950, targetX: 950, color: '#ffb339', dimColor: 'rgba(255,179,57,.13)' },
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
          viewBox="0 0 1200 390"
          role="img"
          aria-labelledby="code-built-screw-title code-built-screw-desc"
          style={{ display: 'block', width: '100%', height: 'auto', minHeight: 250 }}
        >
          <title id="code-built-screw-title">Code-built screw flight measurement map</title>
          <desc id="code-built-screw-desc">
            Interactive coded screw map showing drive spline end, feed, transition, and metering zones, with a tapered screw core and aligned Flight OD callout pills.
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
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#44d7ff" floodOpacity=".2" />
            </filter>
            <clipPath id="codedFlightClip">
              <path d="M260 142 H1080 V250 H260 Z" />
            </clipPath>
            <marker id="codedArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" viewBox="0 0 10 10">
              <path d="M0 0 L10 5 L0 10 Z" fill="#8fe8ff" />
            </marker>
          </defs>

          <rect x="14" y="16" width="1172" height="356" rx="24" fill="#020b13" stroke="rgba(68,215,255,.24)" strokeWidth="2" />
          <rect x="50" y="88" width="1100" height="200" rx="18" fill="url(#codedPanel)" stroke="rgba(68,215,255,.2)" />

          {screwSections.map(section => (
            <g key={section.key}>
              <rect x={section.x1} y="112" width={section.x2 - section.x1} height="146" rx="10" fill={section.dimColor} />
              <line x1={section.x1} y1="96" x2={section.x1} y2="278" stroke="rgba(223,247,255,.16)" strokeDasharray="7 8" />
              <line x1={section.x2} y1="96" x2={section.x2} y2="278" stroke="rgba(223,247,255,.16)" strokeDasharray="7 8" />
              <line x1={section.x1 + 20} y1="278" x2={section.x2 - 20} y2="278" stroke={section.color} strokeWidth="3" strokeLinecap="round" opacity=".62" />
              <text x={(section.x1 + section.x2) / 2} y="326" textAnchor="middle" fill={section.color} fontSize="25" fontWeight="950">{section.shortLabel.toUpperCase()}</text>
            </g>
          ))}

          <g filter="url(#codedScrewShadow)">
            <text x="96" y="164" textAnchor="middle" fill="#eefbff" fontSize="16" fontWeight="950">DRIVE /</text>
            <text x="96" y="184" textAnchor="middle" fill="#eefbff" fontSize="16" fontWeight="950">SPLINE END</text>
            <rect x="72" y="194" width="84" height="48" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.54)" />
            <path d="M86 206 H142 M86 218 H142 M86 230 H142" fill="none" stroke="#eefbff" strokeWidth="5" strokeLinecap="round" opacity=".68" />
            <rect x="156" y="178" width="46" height="80" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.5)" />
            <rect x="202" y="194" width="56" height="48" rx="8" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.42)" />

            <path d="M258 198 C386 198 464 198 520 194 C632 188 720 178 820 164 C900 154 988 150 1080 148 V238 C988 236 900 232 820 224 C720 214 632 206 520 202 C464 200 386 200 258 200 Z" fill="url(#codedSteel)" stroke="rgba(238,251,255,.34)" strokeWidth="1.5" />
            <path d="M258 198 C386 198 464 198 520 194 C632 188 720 178 820 164 C900 154 988 150 1080 148" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M258 200 C386 200 464 200 520 202 C632 206 720 214 820 224 C900 232 988 236 1080 238" fill="none" stroke="rgba(2,7,13,.52)" strokeWidth="4" strokeLinecap="round" />
            <path d="M270 199 C432 199 548 198 666 195 C782 192 922 190 1068 190" fill="none" stroke="rgba(12,24,32,.58)" strokeWidth="4" strokeLinecap="round" opacity=".55" />

            <g clipPath="url(#codedFlightClip)">
              {flightBands.map(x => (
                <g key={x}>
                  <path d={`M${x + 25} 144 L${x + 82} 248`} stroke="rgba(2,7,13,.58)" strokeWidth="8" strokeLinecap="round" />
                  <path d={`M${x} 142 H${x + 34} L${x + 96} 250 H${x + 62} Z`} fill="url(#codedFlight)" stroke="rgba(247,253,255,.72)" strokeWidth="1.3" />
                  <path d={`M${x + 34} 148 L${x + 92} 244`} stroke="rgba(255,255,255,.5)" strokeWidth="2" strokeLinecap="round" />
                </g>
              ))}
            </g>
            <rect x="1080" y="142" width="26" height="108" rx="5" fill="url(#codedDarkSteel)" stroke="rgba(238,251,255,.52)" />
            <line x1="1106" y1="152" x2="1106" y2="240" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" strokeLinecap="round" />
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
                <path d={`M${section.pillX} 92 C${section.pillX} 118 ${section.targetX} 124 ${section.targetX} 146`} fill="none" stroke={section.color} strokeWidth="2.7" strokeLinecap="round" strokeDasharray="8 7" markerEnd="url(#codedArrow)" opacity=".9" />
                <circle cx={section.targetX} cy="146" r="8" fill={section.color} opacity=".95" />
                <circle cx={section.targetX} cy="146" r="17" fill="none" stroke={section.color} strokeWidth="2" opacity=".44" />
                <rect x={section.pillX - 86} y="36" width="172" height="54" rx="17" fill="rgba(2,14,28,.94)" stroke={section.color} strokeWidth="2" filter="url(#codedPillGlow)" />
                <rect x={section.pillX - 74} y="47" width="148" height="32" rx="12" fill={section.dimColor} />
                <text x={section.pillX} y="59" textAnchor="middle" fill="#f3fbff" fontSize="12.5" fontWeight="950" letterSpacing=".35">{section.shortLabel.toUpperCase()} FLIGHT OD</text>
                <text x={section.pillX} y="78" textAnchor="middle" fill={section.color} fontSize="14.5" fontWeight="950">{display}</text>
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
