type ScrewMeasurementKind = 'flight' | 'root';
type ScrewSectionKey = 'feed' | 'transition' | 'metering';

type ScrewMeasurementMapProps = {
  onAddReading: (kind: ScrewMeasurementKind, section: ScrewSectionKey) => void;
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

const flightOffsets = Array.from({ length: 16 }, (_, index) => 262 + index * 54);

export default function ScrewMeasurementMap({ onAddReading }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div className="screw-diagram-controls" aria-label="Screw measurement controls">
        {screwMapSections.map(section => (
          <div className={`screw-diagram-control-column zone-${section.accent}`} key={section.key}>
            <strong className="screw-diagram-column-title">{section.label}</strong>
            <button
              className="screw-diagram-pill flight"
              type="button"
              onClick={() => onAddReading('flight', section.key)}
              aria-label={`Add ${section.shortLabel} Flight OD reading`}
            >
              <span className="screw-diagram-target-icon" aria-hidden="true" />
              <span className="screw-diagram-button-copy"><span>{section.shortLabel}</span><span>Flight OD</span></span>
            </button>
            <button
              className="screw-diagram-pill root"
              type="button"
              onClick={() => onAddReading('root', section.key)}
              aria-label={`Add ${section.shortLabel} Root Dia reading`}
            >
              <span className="screw-diagram-target-icon" aria-hidden="true" />
              <span className="screw-diagram-button-copy"><span>{section.shortLabel}</span><span>Root Dia</span></span>
            </button>
          </div>
        ))}
      </div>

      <div className="screw-diagram-wrap screw-map-inline-shell">
        <svg
          className="screw-map-inline-svg"
          viewBox="0 0 1200 290"
          role="img"
          aria-labelledby="screw-map-title screw-map-desc"
          preserveAspectRatio="xMidYMid meet"
        >
          <title id="screw-map-title">Screw visual map</title>
          <desc id="screw-map-desc">Screw with drive spline end and feed, transition, and metering sections.</desc>
          <defs>
            <linearGradient id="screwInlineCore" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f4fbff" stopOpacity="0.96" />
              <stop offset="0.36" stopColor="#c1d3da" stopOpacity="0.98" />
              <stop offset="0.66" stopColor="#718992" stopOpacity="0.98" />
              <stop offset="1" stopColor="#233039" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwInlineFlight" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
              <stop offset="0.42" stopColor="#b6c8cf" stopOpacity="0.96" />
              <stop offset="1" stopColor="#34444c" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwInlineDrive" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#3e515a" />
              <stop offset="0.5" stopColor="#c4d5dc" />
              <stop offset="1" stopColor="#60757e" />
            </linearGradient>
            <filter id="screwInlineShadow" x="-8%" y="-24%" width="116%" height="148%">
              <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#00070d" floodOpacity="0.38" />
            </filter>
            <clipPath id="screwInlineFlightClip">
              <rect x="220" y="42" width="920" height="144" />
            </clipPath>
          </defs>

          <rect className="screw-inline-zone feed" x="220" y="42" width="305" height="144" />
          <rect className="screw-inline-zone transition" x="525" y="42" width="330" height="144" />
          <rect className="screw-inline-zone metering" x="855" y="42" width="285" height="144" />
          <path className="screw-inline-divider" d="M525 20 V208 M855 20 V208" />
          <path className="screw-inline-od-guide" d="M220 42 H1140 M220 186 H1140" />

          <g filter="url(#screwInlineShadow)">
            <text className="screw-inline-drive-label" x="62" y="83">DRIVE /</text>
            <text className="screw-inline-drive-label" x="62" y="105">SPLINE END</text>
            <rect className="screw-inline-drive-part" x="58" y="112" width="98" height="62" rx="8" />
            <path className="screw-inline-spline-lines" d="M75 125 H139 M75 138 H139 M75 151 H139 M75 164 H139" />
            <rect className="screw-inline-drive-part" x="156" y="99" width="44" height="88" rx="7" />
            <rect className="screw-inline-drive-part" x="200" y="113" width="40" height="62" rx="6" />
            <path className="screw-inline-drive-neck" d="M240 127 L220 120 L220 168 L240 161 Z" />
          </g>

          <g filter="url(#screwInlineShadow)">
            <path className="screw-inline-core" d="M220 120 C330 120 430 120 525 122 C650 125 755 115 855 100 L1140 100 L1140 168 L855 168 C755 158 650 153 525 149 C430 147 330 147 220 147 Z" />
            <path className="screw-inline-core-highlight" d="M220 120 C330 120 430 120 525 122 C650 125 755 115 855 100 L1140 100" />
            <path className="screw-inline-core-midline" d="M220 135 C330 135 430 135 525 137 C650 140 755 132 855 118 L1138 118" />
            <path className="screw-inline-core-shadow" d="M220 147 C330 147 430 147 525 149 C650 153 755 158 855 168 L1140 168" />
            <g clipPath="url(#screwInlineFlightClip)">
              {flightOffsets.map(offset => (
                <g className="screw-inline-flight" key={offset}>
                  <path className="screw-inline-flight-shadow" d={`M${offset + 26} 48 L${offset + 78} 184`} />
                  <path className="screw-inline-flight-body" d={`M${offset} 42 H${offset + 27} L${offset + 82} 186 H${offset + 55} Z`} />
                  <path className="screw-inline-flight-highlight" d={`M${offset + 8} 47 L${offset + 61} 181`} />
                </g>
              ))}
            </g>
            <rect className="screw-inline-flat-end" x="1140" y="45" width="24" height="138" rx="3" />
          </g>

          <g className="screw-inline-labels">
            <g className="feed">
              <path d="M245 216 H500" />
              <text x="372" y="252">FEED</text>
            </g>
            <g className="transition">
              <path d="M560 216 H825" />
              <text x="692" y="252">TRANSITION</text>
            </g>
            <g className="metering">
              <path d="M895 216 H1128" />
              <text x="1012" y="252">METERING</text>
            </g>
          </g>
        </svg>
      </div>
    </section>
  );
}
