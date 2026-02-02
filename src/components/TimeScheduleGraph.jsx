import React, { PureComponent } from "react";

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

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
            hoverIndex: -1,
            currentTime: this.getCurrentTimeMinutes(),
            isPlaying: false,
            playTime: 0,
            draggingData: null
        };
        this.svgRef = React.createRef();
        this.animationFrame = null;
        
        this.throttledPreview = throttle((brightness) => {
            if(this.props.onPreviewBrightness) {
                this.props.onPreviewBrightness(brightness);
            }
       }, 50);
    }

    componentDidMount() {
        this.interval = setInterval(() => {
            this.setState({ currentTime: this.getCurrentTimeMinutes() });
        }, 60000);
    }

    componentWillUnmount() {
        clearInterval(this.interval);
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    }

    getCurrentTimeMinutes() {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
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

    getDisplayPoints() {
        const points = this.getPoints();
        if (points.length === 0) return [];
        
        const first = points[0];
        const last = points[points.length - 1];
        
        const totalDuration = (1440 - last.x) + first.x;
        const wrapSlope = (first.y - last.y) / totalDuration;
        
        const yAt0 = last.y + wrapSlope * (1440 - last.x);
        
        const displayPoints = [
            { x: 0, y: yAt0, virtual: true },
            ...points,
            { x: 1440, y: yAt0, virtual: true }
        ];
        return displayPoints;
    }

    getBrightnessAt(minutes) {
        const displayPoints = this.getDisplayPoints();
        if (displayPoints.length === 0) return 50;

        for(let i=0; i < displayPoints.length - 1; i++) {
            const p1 = displayPoints[i];
            const p2 = displayPoints[i+1];
            if (minutes >= p1.x && minutes <= p2.x) {
                const ratio = (minutes - p1.x) / (p2.x - p1.x);
                return p1.y + (p2.y - p1.y) * ratio;
            }
        }
        return displayPoints[0].y;
    }

    togglePlay = () => {
        if(this.state.isPlaying) {
             this.stopPlay();
        } else {
             this.startPlay();
        }
    }
    
    startPlay = () => {
        if(this.props.onPreviewStart) this.props.onPreviewStart();
        this.setState({ isPlaying: true, playTime: 0 });
        this.lastFrameTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.playLoop);
    }
    
    stopPlay = () => {
        this.setState({ isPlaying: false, playTime: 0 });
        if(this.props.onPreviewEnd) this.props.onPreviewEnd();
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    }
    
    playLoop = (timestamp) => {
        if(!this.state.isPlaying) return;
        
        const elapsed = timestamp - this.lastFrameTime;
        // Speed: 24h in 5 seconds = 1440 min / 5000 ms
        const speed = 1440 / 5000; 
        
        let newTime = this.state.playTime + (elapsed * speed);
        
        if (newTime >= 1440) {
            this.stopPlay();
            return; 
        }
        
        this.lastFrameTime = timestamp;
        this.setState({ playTime: newTime });
        
        const brightness = this.getBrightnessAt(newTime);
        this.throttledPreview(brightness);
        
        this.animationFrame = requestAnimationFrame(this.playLoop);
    }

    handleMouseDown = (index, e) => {
        e.preventDefault();
        this.setState({ draggingIndex: index });
        if(this.props.onPreviewStart) this.props.onPreviewStart();
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

        this.setState({ 
            draggingData: { x: minutes, y: brightness } 
        });
        
        this.throttledPreview(brightness);
        this.updatePoint(this.state.draggingIndex, minutes, brightness);
    };

    handleMouseUp = () => {
        this.setState({ draggingIndex: -1, draggingData: null });
        if(this.props.onPreviewEnd) this.props.onPreviewEnd();
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
        const displayPoints = this.getDisplayPoints();
        const width = 1000; // SVG internal coordinate space
        const height = 200;
        
        // Construct path
        let pathD = "";
        
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
            <div className="time-schedule-graph" style={{position: 'relative'}}>
                <a 
                    style={{ position: 'absolute', top: 0, right: 0, zIndex: 10, cursor: "pointer" }} 
                    className="button"
                    onClick={this.togglePlay}
                >
                    {this.state.isPlaying ? "Stop Test" : "Test Schedule"}
                </a>
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

                    {/* Current Time Indicator */}
                    <line 
                        x1={this.state.currentTime / 1440 * width} y1={0} 
                        x2={this.state.currentTime / 1440 * width} y2={height} 
                        stroke="var(--text-color)" 
                        strokeWidth="2" 
                        strokeDasharray="5,5" 
                        style={{ pointerEvents: "none", opacity: 0.5 }} 
                    />

                    {/* Play Cursor */}
                    {this.state.isPlaying && (
                        <line 
                            x1={this.state.playTime / 1440 * width} y1={0} 
                            x2={this.state.playTime / 1440 * width} y2={height} 
                            stroke="var(--system-accent-color)" 
                            strokeWidth="2" 
                            style={{ pointerEvents: "none" }} 
                        />
                    )}

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
                    
                    {/* Tooltip */}
                    {this.state.draggingData && (
                        <g transform={`translate(${this.state.draggingData.x / 1440 * width}, ${(100 - this.state.draggingData.y) / 100 * height})`}>
                            <rect x="-40" y="-35" width="80" height="25" fill="var(--page-background)" stroke="var(--system-accent-color)" rx="4" />
                            <text x="0" y="-18" textAnchor="middle" fill="var(--text-color)" fontSize="14" dy=".3em">
                                {getTimeStr(this.state.draggingData.x)} • {Math.round(this.state.draggingData.y)}%
                            </text>
                        </g>
                    )}

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
