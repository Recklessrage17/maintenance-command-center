type ScrewMeasurementKind = 'flight' | 'root';
type ScrewSectionKey = 'feed' | 'transition' | 'metering';

type ScrewMeasurementMapProps = {
  onAddReading: (kind: ScrewMeasurementKind, section: ScrewSectionKey) => void;
};

const screwMapSections: Array<{
  key: ScrewSectionKey;
  label: string;
  shortLabel: string;
  start: number;
  end: number;
  accent: 'feed' | 'transition' | 'metering';
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', start: 190, end: 462, accent: 'feed' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', start: 462, end: 738, accent: 'transition' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', start: 738, end: 1032, accent: 'metering' },
];

const screwMapControls = screwMapSections.flatMap(section => [
  { key: `${section.key}-flight`, kind: 'flight' as const, section: section.key, label: `${section.shortLabel} Flight OD`, accent: 'flight' },
  { key: `${section.key}-root`, kind: 'root' as const, section: section.key, label: `${section.shortLabel} Root Dia`, accent: 'root' },
]);

const flightBands = Array.from({ length: 15 }, (_, index) => 178 + index * 58);
const rootCorePath = 'M190 110 C278 108 374 109 462 110 C548 111 648 101 738 92 L1032 92 L1032 190 L738 190 C648 181 548 178 462 176 C374 176 278 178 190 176 Z';
const rootTopPath = 'M190 110 C278 108 374 109 462 110 C548 111 648 101 738 92 L1032 92';
const rootBottomPath = 'M190 176 C278 178 374 176 462 176 C548 178 648 181 738 190 L1032 190';

export default function ScrewMeasurementMap({ onAddReading }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div className="screw-diagram-controls" aria-label="Screw measurement controls">
        {screwMapControls.map(control => (
          <button
            className={`screw-diagram-pill ${control.accent}`}
            type="button"
            key={control.key}
            onClick={() => onAddReading(control.kind, control.section)}
            aria-label={`Add ${control.label} reading`}
          >
            <span className="screw-diagram-target-icon" aria-hidden="true" />
            <span className="screw-diagram-button-copy">{control.label}</span>
          </button>
        ))}
      </div>

      <div className="screw-diagram-wrap">
        <svg
          className="screw-diagram-svg"
          viewBox="0 0 1120 286"
          role="img"
          aria-labelledby="screw-map-title screw-map-description"
          preserveAspectRatio="xMidYMid meet"
        >
          <title id="screw-map-title">Smooth screw measurement map</title>
          <desc id="screw-map-description">
            Smooth screw profile with straight spline drive end, feed, transition, and metering sections.
          </desc>
          <defs>
            <linearGradient id="screwMapPanelGlow" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#0a3147" />
              <stop offset="0.48" stopColor="#061923" />
              <stop offset="1" stopColor="#02080d" />
            </linearGradient>
            <linearGradient id="screwMapCoreFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#eef8fb" stopOpacity="0.84" />
              <stop offset="0.42" stopColor="#8fa6af" stopOpacity="0.92" />
              <stop offset="1" stopColor="#26343b" stopOpacity="0.96" />
            </linearGradient>
            <linearGradient id="screwMapFlightFill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f7fdff" stopOpacity="0.78" />
              <stop offset="0.5" stopColor="#9db5bf" stopOpacity="0.9" />
              <stop offset="1" stopColor="#34444c" stopOpacity="0.96" />
            </linearGradient>
            <linearGradient id="screwMapDriveFill" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#394b54" />
              <stop offset="0.52" stopColor="#b8ccd4" />
              <stop offset="1" stopColor="#5d727b" />
            </linearGradient>
            <filter id="screwMapSoftShadow" x="-8%" y="-28%" width="116%" height="156%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#00070d" floodOpacity="0.38" />
            </filter>
            <clipPath id="screwMapFlightClip">
              <path d="M190 70 H1036 V212 H190 Z" />
            </clipPath>
          </defs>

          <rect className="screw-map-panel-field" x="12" y="12" width="1096" height="260" rx="10" />
          <path className="screw-map-gridline major" d="M60 236 H1060" />
          <path className="screw-map-gridline" d="M190 48 V236 M462 48 V236 M738 48 V236 M1032 48 V236" />

          {screwMapSections.map(section => (
            <rect
              className={`screw-zone-fill ${section.accent}`}
              x={section.start}
              y="54"
              width={section.end - section.start}
              height="170"
              key={section.key}
            />
          ))}

          <g className="screw-drive-assembly" filter="url(#screwMapSoftShadow)">
            <path className="screw-drive-shank" d="M64 120 H142 V162 H64 Z" />
            <path className="screw-drive-collar" d="M142 103 H190 V179 H142 Z" />
            <path className="screw-shoulder-ring" d="M180 94 H202 V188 H180 Z" />
            <path className="screw-spline-groove" d="M76 130 H134 M76 142 H134 M76 154 H134" />
          </g>

          <g className="screw-body-assembly" filter="url(#screwMapSoftShadow)">
            <path className="screw-od-envelope" d="M190 70 H1036 M190 212 H1036" />
            <g className="screw-flight-ribs" clipPath="url(#screwMapFlightClip)">
              {flightBands.map(x => (
                <path
                  className="screw-flight-band"
                  d={`M${x} 70 H${x + 26} L${x + 82} 212 H${x + 56} Z`}
                  key={x}
                />
              ))}
            </g>
            <path className="screw-root-core" d={rootCorePath} />
            <path className="screw-root-highlight" d={rootTopPath} />
            <path className="screw-root-shadow" d={rootBottomPath} />
            <path className="screw-root-edge" d={rootTopPath} />
            <path className="screw-root-edge bottom" d={rootBottomPath} />
            <g className="screw-flight-rim-lines" clipPath="url(#screwMapFlightClip)">
              {flightBands.map(x => (
                <path className="screw-flight-rim" d={`M${x + 27} 72 L${x + 82} 210`} key={x} />
              ))}
            </g>
            <path className="screw-flat-end" d="M1032 70 H1054 V212 H1032 Z" />
            <path className="screw-flat-face" d="M1054 72 V210" />
          </g>

          <g className="screw-section-captions">
            {screwMapSections.map(section => {
              const labelX = section.start + (section.end - section.start) / 2;
              return (
                <g className={`screw-section-caption ${section.accent}`} key={section.key}>
                  <path d={`M${section.start + 14} 238 H${section.end - 14}`} />
                  <text x={labelX} y="259">{section.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
