import React, { useState, useRef, useEffect, MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'motion/react';
import { Play, Minus, Check } from 'lucide-react';

interface Point {
  id: string;
  x: number; // 0 to 1
  y: number; // 0 to 1 (0 is bottom, 1 is top)
}

interface SpeedCurveEditorProps {
  onClose: () => void;
}

export const SpeedCurveEditor: React.FC<SpeedCurveEditorProps> = ({ onClose }) => {
  const [points, setPoints] = useState<Point[]>([
    { id: '1', x: 0, y: 0.5 },
    { id: '2', x: 0.25, y: 0.5 },
    { id: '3', x: 0.5, y: 0.5 },
    { id: '4', x: 0.75, y: 0.5 },
    { id: '5', x: 1, y: 0.5 },
  ]);
  const [selectedPointId, setSelectedPointId] = useState<string>('1');
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playhead, setPlayhead] = useState(0);

  // SVG dimensions
  const [dimensions, setDimensions] = useState({ width: 300, height: 160 });

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelectedPointId(id);
    setIsDragging(true);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent, id: string) => {
    if (!isDragging || selectedPointId !== id || !containerRef.current) return;
    
    // In a real implementation you would only allow interior points to move in X
    // and prevent them from crossing adjacent points.
    // For simplicity, we just allow vertical movement here, and maybe X for mid points
    const rect = containerRef.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    
    // Find point type
    const pointIndex = points.findIndex(p => p.id === id);
    const isEdge = pointIndex === 0 || pointIndex === points.length - 1;

    let x = points[pointIndex].x;
    if (!isEdge) {
      x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      // Clamp between adjacent points
      const prevX = points[pointIndex-1].x;
      const nextX = points[pointIndex+1].x;
      x = Math.max(prevX + 0.05, Math.min(nextX - 0.05, x));
    }

    setPoints(prev => prev.map(p => p.id === id ? { ...p, x, y } : p));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleDeleteBeat = () => {
    const pointIndex = points.findIndex(p => p.id === selectedPointId);
    if (pointIndex > 0 && pointIndex < points.length - 1) {
      setPoints(prev => prev.filter(p => p.id !== selectedPointId));
      setSelectedPointId(points[0].id);
    }
  };

  // Generate SVG path for the curve
  const generatePath = () => {
    if (points.length === 0) return '';
    const w = dimensions.width;
    const h = dimensions.height;
    
    // Sort points by x just in case
    const sorted = [...points].sort((a, b) => a.x - b.x);
    
    let d = `M ${sorted[0].x * w} ${(1 - sorted[0].y) * h}`;
    
    // Use bezier curves or linear. linear for now to match exactly what points mean, 
    // or simple generic spline (like Catmull-Rom or simple bezier if needed)
    // The image shows straight lines between points.
    for (let i = 1; i < sorted.length; i++) {
       d += ` L ${sorted[i].x * w} ${(1 - sorted[i].y) * h}`;
    }
    return d;
  };

  return (
    <div className="flex flex-col w-full bg-[#1a1a1c] rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 text-[#a1a1aa] text-[11px] font-medium font-sans">
          Duration: <span className="text-[#a1a1aa]">6.3s</span> <span className="text-[#e2db81]">→</span> <span className="text-[#e2db81]">6.3s</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="text-white opacity-80 hover:opacity-100">
            <Play size={16} />
          </button>
          
          <button 
            onClick={handleDeleteBeat}
            className="flex items-center gap-1 bg-[#2a2a2c] hover:bg-[#323235] text-[#a1a1aa] hover:text-white px-2 py-1 rounded-[6px] text-[11px] font-medium transition-colors"
          >
            <Minus size={12} /> Delete beat
          </button>

          <button onClick={onClose} className="text-white hover:text-green-400 p-1 opacity-80 hover:opacity-100 ml-1">
            <Check size={16} />
          </button>
        </div>
      </div>

      {/* Editor Area */}
      <div className="px-4 py-2 relative select-none">
        <div 
          ref={containerRef}
          className="relative w-full h-[180px] border border-[#3a3a3c] bg-[#1a1a1c] mb-4"
        >
          {/* Horizontal Grid lines */}
          {/* 10x top solid line is the border */}
          {/* 0.1x bottom solid line is the border */}
          {/* Upper dashed */}
          <div className="absolute top-1/4 left-0 right-0 border-t border-dashed border-[#3a3a3c]" />
          {/* Lower dashed */}
          <div className="absolute top-[75%] left-0 right-0 border-t border-dashed border-[#3a3a3c]" />

          {/* Labels */}
          <div className="absolute top-1 left-2 text-[10px] text-[#71717a] font-medium">10x</div>
          <div className="absolute bottom-1 left-2 text-[10px] text-[#71717a] font-medium">0.1x</div>

          {/* SVG Canvas for lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <path 
              d={generatePath()} 
              fill="none" 
              stroke="#e2db81" 
              strokeWidth="2" 
            />
          </svg>

          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-[1px] bg-white pointer-events-none"
            style={{ left: `${playhead * 100}%` }}
          />

          {/* Points */}
          {points.map((p) => {
            const isSelected = p.id === selectedPointId;
            return (
              <div
                key={p.id}
                onPointerDown={(e) => handlePointerDown(e, p.id)}
                onPointerMove={(e) => handlePointerMove(e, p.id)}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center cursor-pointer touch-none"
                style={{
                  left: `${p.x * 100}%`,
                  top: `${(1 - p.y) * 100}%`,
                  zIndex: isSelected ? 10 : 1
                }}
              >
                <div 
                  className={`rounded-full transition-all duration-150 ${isSelected ? 'w-[18px] h-[18px] bg-white' : 'w-4 h-4 bg-black border-[2.5px] border-white'}`}
                />
              </div>
            );
          })}
        </div>
        
        {/* Footer Actions */}
        <div className="flex justify-center pb-2">
          <button className="bg-[#2a2a2c] hover:bg-[#323235] text-[#71717a] hover:text-white px-4 py-1.5 rounded-[10px] text-[13px] font-medium transition-colors">
            Smooth slow-mo
          </button>
        </div>
      </div>
    </div>
  );
};
