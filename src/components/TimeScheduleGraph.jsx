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

    handleSvgDoubleClick = (e) => {
        if(this.state.draggingIndex !== -1) return;
        
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

        const { adjustmentTimes, onUpdate } = this.props;
        const newTimes = [...adjustmentTimes];
        
        newTimes.push({
            time: getTimeStr(minutes),
            brightness: Math.round(brightness),
            monitors: {} // default empty monitors override
        });

        onUpdate(newTimes);
    };

    handlePointContextMenu = (originalIndex, e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const { adjustmentTimes, onUpdate } = this.props;
        const newTimes = [...adjustmentTimes];
        newTimes.splice(originalIndex, 1);
        onUpdate(newTimes);
    }

    render() {
        const points = this.getPoints();
        const width = 1000; // SVG internal coordinate space
        const height = 200;
        
        // Construct path
        
        let pathD = "";
        
        // Let's create a display list that includes 0 and width.
        const displayPoints = [];
        
        if (points.length > 0) {
            const first = points[0];
            const last = points[points.length - 1];
            
            // Calculate value at 00:00
            // We need the LAST point of the day to determine the start at 00:00
            // The cycle is circular.
            
            const totalDuration = (1440 - last.x) + first.x;
            const wrapSlope = (first.y - last.y) / totalDuration;
            
            const yAt0 = last.y + wrapSlope * (1440 - last.x);
            
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
            <div className="time-schedule-graph">
                <svg 
                    ref={this.svgRef}
                    viewBox={`0 0 ${width} ${height}`} 
                    onMouseMove={this.state.draggingIndex !== -1 ? null : this.handleMouseMove}
                    onDoubleClick={this.handleSvgDoubleClick}
                >
                    {/* Grid lines / Axis */}
                    {[0, 360, 720, 1080, 1440].map(m => (
                        <line key={m} x1={m / 1440 * width} y1={0} x2={m / 1440 * width} y2={height} />
                    ))}
                     {[0, 25, 50, 75, 100].map(b => (
                        <line key={b} x1={0} y1={(100 - b) / 100 * height} x2={width} y2={(100 - b) / 100 * height} />
                    ))}

                    {/* Fill */}
                    <path d={areaD} fill="var(--system-accent-color)" fillOpacity="0.2" stroke="none" style={{ pointerEvents: "none" }} />
                    
                    {/* Line */}
                    <path d={pathD} fill="none" stroke="var(--system-accent-color)" strokeWidth="2" style={{ pointerEvents: "none" }} />

                    {/* Points */}
                    {points.map((p, i) => (
                        <circle 
                            key={i} 
                            cx={p.x / 1440 * width} 
                            cy={(100 - p.y) / 100 * height} 
                            r={this.state.hoverIndex === i || this.state.draggingIndex === p.originalIndex ? 8 : 5}
                            fill={p.isSunCalc ? "#FFA500" : "var(--page-background)"}
                            stroke="var(--system-accent-color)"
                            strokeWidth="2"
                            style={{ cursor: "pointer" }}
                            onMouseDown={(e) => this.handleMouseDown(p.originalIndex, e)}
                            onContextMenu={(e) => this.handlePointContextMenu(p.originalIndex, e)}
                            onMouseEnter={() => this.setState({ hoverIndex: i })}
                            onMouseLeave={() => this.setState({ hoverIndex: -1 })}
                        />
                    ))}
                    
                    {/* X Axis Labels */}
                    <text x={0} y={height + 15} textAnchor="start">00:00</text>
                    <text x={width/4} y={height + 15} textAnchor="middle">06:00</text>
                    <text x={width/2} y={height + 15} textAnchor="middle">12:00</text>
                    <text x={width*0.75} y={height + 15} textAnchor="middle">18:00</text>
                    <text x={width} y={height + 15} textAnchor="end">24:00</text>
                </svg>
            </div>
        );
    }
}
