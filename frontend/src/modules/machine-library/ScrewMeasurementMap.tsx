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
  color: string;
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', accent: 'feed', color: '#44d7ff' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', accent: 'transition', color: '#36e5aa' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', accent: 'metering', color: '#ffb339' },
];

const flightCallouts: Array<{
  key: ScrewSectionKey;
  label: string;
  left: number;
  top: number;
  targetX: number;
  targetY: number;
  color: string;
  glow: string;
}> = [
  { key: 'feed', label: 'Feed', left: 31, top: 21, targetX: 35, targetY: 47, color: '#44d7ff', glow: 'rgba(68,215,255,.28)' },
  { key: 'transition', label: 'Transition', left: 53, top: 16, targetX: 54, targetY: 46, color: '#36e5aa', glow: 'rgba(54,229,170,.26)' },
  { key: 'metering', label: 'Metering', left: 76, top: 21, targetX: 75, targetY: 46, color: '#ffb339', glow: 'rgba(255,179,57,.26)' },
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
        aria-label="Flight OD quick add controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '7px 8px',
          border: '1px solid rgba(68,215,255,.18)',
          borderRadius: 10,
          background: 'rgba(3,10,18,.42)',
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
        {screwMapSections.map(section => (
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

      <div className="screw-diagram-wrap" style={{ padding: 10, overflow: 'hidden' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 980, margin: '0 auto' }}>
          <img
            className="measurement-screw-map-final"
            src="/measurement-screw-map-final.png"
            alt="Screw measurement map showing feed, transition, and metering sections"
            style={{ display: 'block', width: '100%', maxHeight: 300, objectFit: 'contain', margin: '0 auto' }}
          />

          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
          >
            <defs>
              <marker id="flightArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="#8fe8ff" />
              </marker>
            </defs>
            {flightCallouts.map(callout => (
              <g key={callout.key}>
                <path
                  d={`M${callout.left} ${callout.top + 7} C${callout.left + 2} ${callout.top + 18}, ${callout.targetX - 4} ${callout.targetY - 10}, ${callout.targetX} ${callout.targetY}`}
                  fill="none"
                  stroke={callout.color}
                  strokeWidth="0.75"
                  strokeLinecap="round"
                  strokeDasharray="1.6 1.5"
                  markerEnd="url(#flightArrowHead)"
                  opacity="0.9"
                />
                <circle cx={callout.targetX} cy={callout.targetY} r="1.4" fill={callout.color} opacity="0.92" />
                <circle cx={callout.targetX} cy={callout.targetY} r="3" fill="none" stroke={callout.color} strokeWidth="0.55" opacity="0.72" />
              </g>
            ))}
          </svg>

          {flightCallouts.map(callout => (
            <button
              key={callout.key}
              type="button"
              onClick={() => onAddReading('flight', callout.key)}
              aria-label={`Add ${callout.label} Flight OD reading`}
              style={{
                position: 'absolute',
                left: `${callout.left}%`,
                top: `${callout.top}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 2,
                minWidth: 142,
                minHeight: 42,
                display: 'grid',
                gap: 2,
                alignContent: 'center',
                padding: '6px 12px',
                border: `1.5px solid ${callout.color}`,
                borderRadius: 15,
                color: '#f3fbff',
                background: `linear-gradient(145deg, rgba(2,14,28,.94), ${callout.glow})`,
                boxShadow: `0 12px 28px rgba(0,0,0,.34), 0 0 20px ${callout.glow}`,
                font: 'inherit',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <span style={{ color: '#f3fbff', fontSize: '.64rem', fontWeight: 950, letterSpacing: '.04em', textTransform: 'uppercase' }}>{callout.label} Flight OD</span>
              <strong style={{ color: callout.color, fontSize: '.8rem', lineHeight: 1.1 }}>{compactMeasurementDisplay(latestReading(readings, callout.key))}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="screw-diagram-legend" aria-label="Screw visual legend">
        <span className="flight">Flight OD = outside diameter over the flights</span>
        <span className="root">Root Dia layout will match this after Flight is approved</span>
      </div>
    </section>
  );
}
