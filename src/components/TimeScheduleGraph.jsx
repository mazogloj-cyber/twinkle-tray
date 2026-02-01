import React, { PureComponent } from "react";

const getMinutes = (timeStr) => {
    if(!timeStr) return 0;
    
    // Check for AM/PM
    const isPM = timeStr.toLowerCase().includes("pm");
    const isAM = timeStr.toLowerCase().includes("am");
    let [h, m] = timeStr.replace(/(am|pm)/i, "").trim().split(":").map(Number);
    
    if (isPM && h !== 12) h += 12;
    if (isAM && h === 12) h = 0;
    
    return h * 60 + m;
};

const getTimeStr = (minutes) => {
    let h = Math.floor(minutes / 60);
    let m = Math.floor(minutes % 60);
    if (h < 0) h = 0;
    if (h > 23) h = 23;
    if (m < 0) m = 0;
    if (m > 59) m = 59;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

export default class TimeScheduleGraph extends PureComponent {
    constructor(props) {
        super(props);
        this.state = {
            draggingIndex: -1,
            hoverIndex: -1
        };
        this.svgRef = React.createRef();
    }

    getPoints() {
        const { adjustmentTimes, lat, long } = this.props;
        
        let sunTimes = {};
        if (window.getSunCalcTimes && (lat || long)) {
             // We use a dummy date or current date? window.getSunCalcTimes uses new Date() internally
            sunTimes = window.getSunCalcTimes(lat, long);
        }

        return adjustmentTimes.map((item, index) => {
            let timeStr = item.time;
            if (item.useSunCalc && item.sunCalc && sunTimes[item.sunCalc]) {
                timeStr = sunTimes[item.sunCalc];
            }
            
            // Handle edge cases where sun times might be missing or invalid
            if(!timeStr) timeStr = "12:00"; 

            return {
                x: getMinutes(timeStr), // 0 - 1440
                y: item.brightness,     // 0 - 100
                originalIndex: index,
                isSunCalc: item.useSunCalc
            };
        }).sort((a, b) => a.x - b.x);
    }

    handleMouseDown = (index, e) => {
        e.preventDefault();
        this.setState({ draggingIndex: index });
        document.addEventListener("mousemove", this.handleMouseMove);
        document.addEventListener("mouseup", this.handleMouseUp);
    };

    handleMouseMove = (e) => {
        if (this.state.draggingIndex === -1) return;
        
        const svg = this.svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Convert to data coordinates
        let minutes = (x / rect.width) * 1440;
        let brightness = 100 - (y / rect.height) * 100;

        // Clamp
        if (minutes < 0) minutes = 0;
        if (minutes > 1439) minutes = 1439;
        if (brightness < 0) brightness = 0;
        if (brightness > 100) brightness = 100;

        this.updatePoint(this.state.draggingIndex, minutes, brightness);
    };

    handleMouseUp = () => {
        this.setState({ draggingIndex: -1 });
        document.removeEventListener("mousemove", this.handleMouseMove);
        document.removeEventListener("mouseup", this.handleMouseUp);
    };

    updatePoint = (originalIndex, minutes, brightness) => {
        const { adjustmentTimes, onUpdate } = this.props;
        const newTimes = [...adjustmentTimes];
        const point = newTimes[originalIndex];

        // If dragging, we convert to fixed time
        point.useSunCalc = false; 
        point.time = getTimeStr(minutes);
        point.brightness = Math.round(brightness);

        onUpdate(newTimes);
    };

    render() {
        const points = this.getPoints();
        const width = 1000; // SVG internal coordinate space
        const height = 200;
        
        // Construct path
        // We need to handle the wrap-around logic for the path to look continuous if we want
        // But for now, just connecting points is fine. 
        // Ideally, we should show the line from 00:00 to the first point (from last point's value)
        // and from last point to 24:00 (wrapping to first point's value? or just flat?)
        // The app logic interpolates between "current and next". 
        // So visually:
        // 00:00 value = (last event of yesterday) -> (first event of today)
        // For simplicity, let's just connect the points sorted by time.
        
        let pathD = "";
        
        // Add a "virtual" point at 00:00 and 24:00 for visualization if needed
        // The app logic: "Brightness values will be animated between the current and next scheduled event."
        // This implies if I have 10:00 (50%) and 20:00 (100%), then:
        // 10:00 -> 20:00 is a gradient 50->100.
        // 20:00 -> 10:00 (next day) is a gradient 100->50.
        
        // So to visualize this correctly:
        // We need the LAST point of the day to determine the start at 00:00?
        // Actually, the cycle is circular.
        // Let's draw:
        // Point at x=0 (Time 00:00): Value is interpolated between last point and first point.
        // If we only have points, we can draw lines between them.
        // We also need to draw the line from "Last Point" to "24:00" (which is same val as "First Point" at "24:00 + first_time"? No).
        
        // Let's create a display list that includes 0 and width.
        const displayPoints = [];
        
        if (points.length > 0) {
            const first = points[0];
            const last = points[points.length - 1];
            
            // Calculate value at 00:00
            // It is on the line between last (moved to x - 1440) and first? 
            // Distance between last and first (wrapping): (1440 - last.x) + first.x
            // Value at 0 = last.y + (first.y - last.y) * ((1440 - last.x) / totalDist) ?
            // This is getting complicated. Let's just draw lines between the defined points for now, 
            // and maybe dashed lines to edges.
            
            // Simple path: Connect all points.
            // Also connect 0 to first point (dotted?) and last point to 1440?
            // Let's just draw the polygon.
            
            // Better visual:
            // Prepend a point at x=0, y = interpolated
            // Append a point at x=1440, y = interpolated
            
            const totalDuration = (1440 - last.x) + first.x;
            const wrapSlope = (first.y - last.y) / totalDuration;
            
            const yAt0 = last.y + wrapSlope * (1440 - last.x);
            const yAt1440 = first.y - wrapSlope * (0 - (1440 - last.x)); // logic check...
            // Actually yAt1440 should just be yAt0 because it wraps.
            
            // Wait, yAt0 should be:
            // The value at 24:00 yesterday (which is same as 00:00 today).
            // Time delta from last event to 00:00 is (1440 - last.x).
            // Value change is based on slope towards first.y at time (1440 + first.x).
            
            displayPoints.push({ x: 0, y: yAt0, virtual: true });
            points.forEach(p => displayPoints.push(p));
            displayPoints.push({ x: 1440, y: yAt0, virtual: true });
        }
        
        // Generate Path
        if (displayPoints.length > 0) {
            pathD = `M ${displayPoints[0].x / 1440 * width} ${(100 - displayPoints[0].y) / 100 * height} `;
            for (let i = 1; i < displayPoints.length; i++) {
                const p = displayPoints[i];
                pathD += `L ${p.x / 1440 * width} ${(100 - p.y) / 100 * height} `;
            }
        }

        // Generate Area (for fill)
        let areaD = pathD;
        if (displayPoints.length > 0) {
            areaD += `L ${width} ${height} L 0 ${height} Z`;
        }

        return (
            <div className="time-schedule-graph" style={{ padding: "10px 0", userSelect: "none" }}>
                <svg 
                    ref={this.svgRef}
                    viewBox={`0 0 ${width} ${height}`} 
                    style={{ width: "100%", height: "200px", background: "rgba(0,0,0,0.1)", borderRadius: "6px", overflow: "visible" }}
                    onMouseMove={this.state.draggingIndex !== -1 ? null : this.onMouseMove}
                >
                    {/* Grid lines / Axis */}
                    {[0, 360, 720, 1080, 1440].map(m => (
                        <line key={m} x1={m / 1440 * width} y1={0} x2={m / 1440 * width} y2={height} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                    ))}
                     {[0, 25, 50, 75, 100].map(b => (
                        <line key={b} x1={0} y1={(100 - b) / 100 * height} x2={width} y2={(100 - b) / 100 * height} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                    ))}

                    {/* Fill */}
                    <path d={areaD} fill="rgba(0, 120, 215, 0.2)" stroke="none" />
                    
                    {/* Line */}
                    <path d={pathD} fill="none" stroke="#0078D7" strokeWidth="2" />

                    {/* Points */}
                    {points.map((p, i) => (
                        <circle 
                            key={i} 
                            cx={p.x / 1440 * width} 
                            cy={(100 - p.y) / 100 * height} 
                            r={this.state.hoverIndex === i || this.state.draggingIndex === p.originalIndex ? 8 : 5}
                            fill={p.isSunCalc ? "#FFA500" : "#FFFFFF"}
                            stroke="#0078D7"
                            strokeWidth="2"
                            style={{ cursor: "pointer" }}
                            onMouseDown={(e) => this.handleMouseDown(p.originalIndex, e)}
                            onMouseEnter={() => this.setState({ hoverIndex: i })}
                            onMouseLeave={() => this.setState({ hoverIndex: -1 })}
                        />
                    ))}
                    
                    {/* X Axis Labels */}
                    <text x={0} y={height + 15} fill="currentColor" fontSize="12" textAnchor="start">00:00</text>
                    <text x={width/4} y={height + 15} fill="currentColor" fontSize="12" textAnchor="middle">06:00</text>
                    <text x={width/2} y={height + 15} fill="currentColor" fontSize="12" textAnchor="middle">12:00</text>
                    <text x={width*0.75} y={height + 15} fill="currentColor" fontSize="12" textAnchor="middle">18:00</text>
                    <text x={width} y={height + 15} fill="currentColor" fontSize="12" textAnchor="end">24:00</text>
                </svg>
            </div>
        );
    }
}
