type ScrewMeasurementKind = 'flight' | 'root';
 type ScrewSectionKey = 'feed' | 'transition' | 'metering';
 
 type ScrewMeasurementMapProps = {
   onAddReading: (kind: ScrewMeasurementKind, section: ScrewSectionKey) => void;
 };
 
 const screwMapSections: Array<{
   key: ScrewSectionKey;
   label: string;
   shortLabel: string;
   subLabel: string;
   start: number;
   end: number;
   accent: 'feed' | 'transition' | 'metering';
 }> = [
   { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', subLabel: 'Deep Channel / Smaller Core', start: 230, end: 505, accent: 'feed' },
   { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', subLabel: 'Core Smoothly Increases', start: 505, end: 790, accent: 'transition' },
   { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', subLabel: 'Shallow Channel / Larger Core', start: 790, end: 1038, accent: 'metering' },
 ];
 
 const screwMapControls = screwMapSections.flatMap(section => [
   { key: `${section.key}-flight`, kind: 'flight' as const, section: section.key, label: `${section.shortLabel} Flight OD`, accent: 'flight' },
   { key: `${section.key}-root`, kind: 'root' as const, section: section.key, label: `${section.shortLabel} Root Dia`, accent: 'root' },
 ]);
 
 const flightBands = Array.from({ length: 18 }, (_, index) => 248 + index * 48);
 const rootCorePath = 'M230 132 C330 132 420 132 505 134 C612 136 704 128 790 118 L1038 118 L1038 190 L790 190 C704 180 612 176 505 174 C420 172 330 172 230 172 Z';
 const rootTopPath = 'M230 132 C330 132 420 132 505 134 C612 136 704 128 790 118 L1038 118';
 const rootCenterHighlight = 'M232 146 C344 146 430 146 505 147 C612 149 704 143 790 136 L1034 136';
 const rootBottomPath = 'M230 172 C330 172 420 172 505 174 C612 176 704 180 790 190 L1038 190';
 
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
           viewBox="0 0 1120 312"
           role="img"
           aria-labelledby="screw-map-title screw-map-description"
           preserveAspectRatio="xMidYMid meet"
         >
           <title id="screw-map-title">Smooth screw measurement map</title>
           <desc id="screw-map-description">
             Smooth screw profile with straight spline drive end, feed, transition, metering sections, solid flights, and a clean flat end.
           </desc>
           <defs>
             <linearGradient id="screwMapPanelGlow" x1="0" x2="1" y1="0" y2="1">
               <stop offset="0" stopColor="#071e2e" />
               <stop offset="0.5" stopColor="#04131f" />
               <stop offset="1" stopColor="#02070d" />
             </linearGradient>
             <linearGradient id="screwMapCoreFill" x1="0" x2="0" y1="0" y2="1">
               <stop offset="0" stopColor="#f1fbff" stopOpacity="0.92" />
               <stop offset="0.36" stopColor="#c4d3d8" stopOpacity="0.96" />
               <stop offset="0.58" stopColor="#7f969f" stopOpacity="0.98" />
               <stop offset="1" stopColor="#26343b" stopOpacity="0.98" />
             </linearGradient>
             <linearGradient id="screwMapFlightFill" x1="0" x2="1" y1="0" y2="1">
               <stop offset="0" stopColor="#f8fdff" stopOpacity="0.88" />
               <stop offset="0.38" stopColor="#b6c8cf" stopOpacity="0.94" />
               <stop offset="1" stopColor="#34444c" stopOpacity="0.98" />
             </linearGradient>
             <linearGradient id="screwMapDriveFill" x1="0" x2="1" y1="0" y2="0">
               <stop offset="0" stopColor="#394b54" />
               <stop offset="0.48" stopColor="#b8ccd4" />
               <stop offset="1" stopColor="#5d727b" />
             </linearGradient>
             <filter id="screwMapSoftShadow" x="-8%" y="-28%" width="116%" height="156%">
               <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#00070d" floodOpacity="0.36" />
             </filter>
             <clipPath id="screwMapFlightClip">
               <path d="M230 74 H1040 V220 H230 Z" />
             </clipPath>
           </defs>
 
           <rect className="screw-map-panel-field" x="16" y="12" width="1088" height="286" rx="12" />
           <path className="screw-map-gridline major" d="M90 246 H1068" />
           <path className="screw-map-gridline" d="M230 54 V246 M505 54 V246 M790 54 V246 M1038 54 V246" />
 
           {screwMapSections.map(section => (
             <rect
               className={`screw-zone-fill ${section.accent}`}
               x={section.start}
               y="74"
               width={section.end - section.start}
               height="146"
               key={section.key}
             />
           ))}
 
           <g className="screw-drive-assembly" filter="url(#screwMapSoftShadow)">
             <rect className="screw-drive-shank" x="72" y="126" width="92" height="62" rx="8" />
             <path className="screw-spline-groove" d="M86 138 H150 M86 150 H150 M86 162 H150 M86 174 H150" />
             <rect className="screw-drive-collar" x="164" y="116" width="42" height="82" rx="7" />
             <rect className="screw-shoulder-ring" x="206" y="124" width="38" height="66" rx="5" />
             <path className="screw-drive-neck" d="M244 138 L230 132 L230 172 L244 166 Z" />
           </g>
 
           <g className="screw-body-assembly" filter="url(#screwMapSoftShadow)">
             <path className="screw-od-envelope" d="M230 74 H1038 M230 220 H1038" />
             <path className="screw-root-core" d={rootCorePath} />
             <path className="screw-root-highlight" d={rootTopPath} />
             <path className="screw-root-center-highlight" d={rootCenterHighlight} />
             <path className="screw-root-shadow" d={rootBottomPath} />
             <g className="screw-flight-ribs" clipPath="url(#screwMapFlightClip)">
               {flightBands.map(x => (
                 <g className="screw-flight-band-group" key={x}>
                   <path className="screw-flight-shadow" d={`M${x + 32} 78 L${x + 84} 218`} />
                   <path
                     className="screw-flight-band"
                     d={`M${x} 76 H${x + 24} L${x + 80} 218 H${x + 56} Z`}
                   />
                   <path className="screw-flight-rim" d={`M${x + 6} 80 L${x + 60} 214`} />
                 </g>
               ))}
             </g>
             <path className="screw-root-edge" d={rootTopPath} />
             <path className="screw-root-edge bottom" d={rootBottomPath} />
             <path className="screw-flat-end" d="M1038 76 H1058 V218 H1038 Z" />
             <path className="screw-flat-face" d="M1058 82 V212" />
           </g>
 
           <g className="screw-section-captions">
             {screwMapSections.map(section => {
               const labelX = section.start + (section.end - section.start) / 2;
               return (
                 <g className={`screw-section-caption ${section.accent}`} key={section.key}>
                   <path d={`M${section.start + 14} 254 H${section.end - 14}`} />
                   <text x={labelX} y="275">{section.label}</text>
                   <text className="screw-section-caption-sub" x={labelX} y="294">{section.subLabel}</text>
                 </g>
               );
             })}
           </g>
         </svg>
       </div>
     </section>
   );
 }