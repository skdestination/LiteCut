import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  Play,
  Pause,
  Undo2,
  Redo2,
  Trash2,
  PlusCircle,
  ChevronLeft,
  ArrowUpDown,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Scissors,
  Clock,
  SlidersHorizontal,
  Crop,
  Star,
  MoreVertical,
  Plus as PlusIcon,
  Settings,
  Copy,
  Check,
  X,
  Save,
  Move,
  Wand2,
  Activity,
  Blend,
  SkipBack,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Type,
  Smile,
  Image as ImageIcon,
  ListOrdered,
  List,
  Diamond,
  LineChart,
  SquareDashed,
  Music,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { get, set } from "idb-keyval";
import { SpeedCurveEditor } from "./SpeedCurveEditor";

type Screen = "home" | "editor" | "settings";

type Layer = {
  id: string; // unique ID
  order: number; // For Up/Down sorting. Lower = deeper layer, Higher = top layer.
  isMuted: boolean;
  isHidden: boolean;
};

type Keyframe = {
  id: string;
  timeOffset: number; // Offset from clip's leftSeconds
  properties: {
    volume?: number;
    translateX?: number;
    translateY?: number;
    rotation?: number;
    scale?: number;
    opacity?: number;
  };
  curve?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";
};

type Clip = {
  id: string;
  layerId: string;
  type: "video" | "image" | "audio" | "text";
  src: string;
  fileId?: string;
  text?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  leftSeconds: number; // Start time on timeline
  durationSeconds: number; // Length on timeline
  trimStartSeconds: number; // Offset within the source media
  volume?: number; // 0 to 100
  speed?: number; // playback speed modifier
  opticalFlow?: boolean; // smooth slow-motion
  translateX?: number;
  translateY?: number;
  rotation?: number;
  scale?: number;
  maskType?: "none" | "circle" | "square" | "rounded";
  cropRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "free" | null;
  cropRect?: { top: number, right: number, bottom: number, left: number };
  opacity?: number;
  mixBlendMode?: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
  keyframes?: Keyframe[];
};

type Project = {
  id: string;
  name: string;
  ratio: string;
  updatedAt: string;
  duration: string;
  size: string;
  thumbnail: string;
  layers: Layer[];
  clips: Clip[];
};

// --- Mock Data & Constants ---
const BASE_PIXELS_PER_SECOND = 100;

function getInterpolatedProps(clip: Clip, timeInClip: number) {
  if (!clip.keyframes || clip.keyframes.length === 0) {
    return {
      translateX: clip.translateX,
      translateY: clip.translateY,
      rotation: clip.rotation,
      scale: clip.scale,
      opacity: clip.opacity,
      volume: clip.volume,
    };
  }

  const kfs = [...clip.keyframes].sort((a, b) => a.timeOffset - b.timeOffset);

  if (timeInClip <= kfs[0].timeOffset) {
    return { ...kfs[0].properties };
  }
  if (timeInClip >= kfs[kfs.length - 1].timeOffset) {
    return { ...kfs[kfs.length - 1].properties };
  }

  for (let i = 0; i < kfs.length - 1; i++) {
    const startKf = kfs[i];
    const endKf = kfs[i + 1];

    if (timeInClip >= startKf.timeOffset && timeInClip <= endKf.timeOffset) {
      const range = endKf.timeOffset - startKf.timeOffset;
      // linear interpolation
      let progress = (timeInClip - startKf.timeOffset) / range;
      
      switch (startKf.curve) {
        case "easeIn": 
          progress = progress * progress; 
          break;
        case "easeOut": 
          progress = progress * (2 - progress); 
          break;
        case "easeInOut": 
          progress = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress; 
          break;
        case "hold": 
          progress = 0; 
          break;
        case "linear": 
        default: 
          break;
      }

      const interpolate = (start: number | undefined, end: number | undefined, fallback: number) => {
        const s = start ?? fallback;
        const e = end ?? fallback;
        return s + (e - s) * progress;
      };

      return {
        translateX: interpolate(startKf.properties.translateX, endKf.properties.translateX, clip.translateX || 0),
        translateY: interpolate(startKf.properties.translateY, endKf.properties.translateY, clip.translateY || 0),
        rotation: interpolate(startKf.properties.rotation, endKf.properties.rotation, clip.rotation || 0),
        scale: Math.max(0.01, interpolate(startKf.properties.scale, endKf.properties.scale, clip.scale ?? 1)),
        opacity: Math.max(0, Math.min(1, interpolate(startKf.properties.opacity, endKf.properties.opacity, clip.opacity ?? 1))),
        volume: Math.max(0, Math.min(100, interpolate(startKf.properties.volume, endKf.properties.volume, clip.volume ?? 100))),
      };
    }
  }

  return {
    translateX: clip.translateX,
    translateY: clip.translateY,
    rotation: clip.rotation,
    scale: clip.scale,
    opacity: clip.opacity,
    volume: clip.volume,
  };
}

export const DEFAULT_FLOW_BAR_ORDER = [
  'volume',
  'text',
  'crop',
  'adjust',
  'speed',
  'copy',
  'extract-audio',
  'move',
  'magic',
  'activity',
  'mask',
];

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>("home");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(
    null,
  );
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  const [flowBarOrder, setFlowBarOrder] = useState<string[]>(DEFAULT_FLOW_BAR_ORDER);

  const [isProjectsLoaded, setIsProjectsLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedOrder = await get("ai_studio_video_flowbar_order");
        if (savedOrder) setFlowBarOrder(savedOrder);
      } catch (e) {}

      try {
        const saved = await get("ai_studio_video_projects");
        if (saved) {
          setProjects(saved);
        } else {
          setProjects([
            {
              id: "1",
              name: "Summer Vacation",
              ratio: "9:16",
              updatedAt: "2 hours ago",
              duration: "00:15",
              size: "124 MB",
              thumbnail:
                "https://images.unsplash.com/photo-1542204165-65bf26472b9b?auto=format&fit=crop&q=80&w=300",
              layers: [],
              clips: [],
            },
          ]);
        }
      } catch (e) {
        console.error("Failed to load projects from IDB", e);
      }
      setIsProjectsLoaded(true);
    };
    loadState();
  }, []);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [selectedRatioTransition, setSelectedRatioTransition] = useState<
    string | null
  >(null);
  const [focusedRatio, setFocusedRatio] = useState<string>("9:16");

  // Editor State
  const [currentProjectRatio, setCurrentProjectRatio] =
    useState<string>("9:16");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = normal, 2 = zoomed in
  const [playheadX, setPlayheadX] = useState(150);
  const playheadXRef = useRef(150);
  const [activeExpandedMenu, setActiveExpandedMenu] = useState<string | null>(
    null,
  );
  const [layerMenuOpenId, setLayerMenuOpenId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const hasDraggedLayerRef = useRef(false);
  const [applyVolumeToAll, setApplyVolumeToAll] = useState(false);
  const [clipVolume, setClipVolume] = useState(100);
  const [clipSpeed, setClipSpeed] = useState(1);
  const [smoothProcessingProgress, setSmoothProcessingProgress] = useState<
    number | null
  >(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const selectedClipId = selectedClipIds.length === 1 ? selectedClipIds[0] : null;
  const setSelectedClipId = (id: string | null) => setSelectedClipIds(id === null ? [] : [id]);
  const [marquee, setMarquee] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
  const [showKeyframeGraph, setShowKeyframeGraph] = useState(false);
  
  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const isAtKeyframe = selectedClip?.keyframes?.some(k => Math.abs(currentTime - (selectedClip.leftSeconds + k.timeOffset)) < 0.05) ?? false;
  const isBetweenKeyframes = (selectedClip?.keyframes?.length ?? 0) >= 2;

  const [isExportExpanded, setIsExportExpanded] = useState(false);
  const [exportResolution, setExportResolution] = useState("4K");
  const [exportFps, setExportFps] = useState("30");
  const [exportBitrate, setExportBitrate] = useState("High");
  const [exportOpticalFlow, setExportOpticalFlow] = useState(true);
  const [erroredClips, setErroredClips] = useState<Set<string>>(new Set());

  const handleClipError = (clipId: string) => {
    setErroredClips((prev) => {
      if (prev.has(clipId)) return prev;
      const newSet = new Set(prev);
      newSet.add(clipId);
      return newSet;
    });
  };

  const [copiedClip, setCopiedClip] = useState<Clip | null>(null);
  const [pastePopup, setPastePopup] = useState<{
    x: number;
    y: number;
    time: number;
    layerId?: string;
  } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerMoveCanvasRef = useRef(false);

  const [history, setHistory] = useState<{ layers: Layer[]; clips: Clip[] }[]>([
    { layers: [], clips: [] },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isUndoRedoAction = useRef(false);

  useEffect(() => {
    if (selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip) {
        setClipVolume(typeof clip.volume === "number" ? clip.volume : 100);
      }
    }
  }, [selectedClipId]);

  useEffect(() => {
    // Intentional omission of empty layer cleanup so users can add empty layers
  }, [clips, layers]);

  useEffect(() => {
    if (isUndoRedoAction.current) {
      isUndoRedoAction.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      setHistory((prev) => {
        const last = prev[historyIndex] || prev[prev.length - 1];
        if (
          last &&
          JSON.stringify(last.layers) === JSON.stringify(layers) &&
          JSON.stringify(last.clips) === JSON.stringify(clips)
        ) {
          return prev;
        }
        let newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push({ layers, clips });
        if (newHistory.length > 50)
          newHistory = newHistory.slice(newHistory.length - 50);
        setHistoryIndex(newHistory.length - 1);
        return newHistory;
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [layers, clips, historyIndex]);

  const undo = () => {
    if (historyIndex > 0) {
      isUndoRedoAction.current = true;
      const prev = history[historyIndex - 1];
      setLayers(prev.layers);
      setClips(prev.clips);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      isUndoRedoAction.current = true;
      const next = history[historyIndex + 1];
      setLayers(next.layers);
      setClips(next.clips);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>();

  // Real-time synchronization
  const isPlayingRef = useRef(isPlaying);
  // Important: timeline zoom level affects pixels per second
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoomLevel;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const playLoop = (time: number) => {
      if (lastTimeRef.current === undefined) lastTimeRef.current = time;
      const deltaTime = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (isPlayingRef.current) {
        setCurrentTime((prev) => {
          const next = prev + deltaTime;
          if (timelineScrollRef.current) {
            const container = timelineScrollRef.current;
            container.scrollLeft = Math.max(
              0,
              next * pixelsPerSecond - playheadXRef.current,
            );
          }
          return next;
        });
      }
      animationFrameRef.current = requestAnimationFrame(playLoop);
    };
    animationFrameRef.current = requestAnimationFrame(playLoop);

    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
    };
  }, [pixelsPerSecond]);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const startExport = async () => {
    let maxDuration = 0;
    for (const c of clips) {
      if (c.leftSeconds + c.durationSeconds > maxDuration) {
        maxDuration = c.leftSeconds + c.durationSeconds;
      }
    }
    if (maxDuration === 0) {
      showToast("No clips to export.");
      setIsExportExpanded(false);
      return;
    }

    setIsExportExpanded(false);
    setIsExporting(true);
    setExportProgress(0);
    setCurrentTime(0);
    setIsPlaying(false);

    await new Promise((r) => setTimeout(r, 600)); // wait for video seek

    const canvas = document.createElement("canvas");
    let exportWidth = 1920;
    let exportHeight = 1080;
    if (exportResolution === "4K") {
      exportWidth = 3840;
      exportHeight = 2160;
    }
    if (exportResolution === "2K") {
      exportWidth = 2560;
      exportHeight = 1440;
    }

    const [rw, rh] = currentProjectRatio.split(":").map(Number);
    if (rw && rh) {
      if (rw < rh) {
        canvas.height = exportHeight;
        canvas.width = exportHeight * (rw / rh);
      } else {
        canvas.width = exportWidth;
        canvas.height = exportWidth * (rh / rw);
      }
    }
    const ctx = canvas.getContext("2d")!;

    const fps = parseInt(exportFps) || 30;
    const stream = canvas.captureStream(fps);

    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${exportResolution}-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExporting(false);
      setExportProgress(0);
      setIsPlaying(false);
    };

    recorder.start();
    setIsPlaying(true);

    const previewEl = document.getElementById("preview-screen");
    const previewW = previewEl?.clientWidth || 1;
    const previewH = previewEl?.clientHeight || 1;

    const startTime = performance.now();
    let rAF: number;
    let playingLocal = true;

    const drawFn = () => {
      if (!playingLocal) return;

      const elapsed = (performance.now() - startTime) / 1000;

      if (elapsed >= maxDuration + 0.1) {
        playingLocal = false;
        recorder.stop();
        return;
      }

      setExportProgress(
        Math.min(100, Math.round((elapsed / maxDuration) * 100)),
      );

      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const layerOrder = [...layers].sort((a, b) => a.order - b.order);
      for (const layer of layerOrder) {
        if (layer.isHidden) continue;
        const clip = clips.find(
          (c) =>
            c.layerId === layer.id &&
            elapsed >= c.leftSeconds &&
            elapsed <= c.leftSeconds + c.durationSeconds,
        );
        if (!clip) continue;

        const elId = `clip-media-${clip.id}`;
        const el = document.getElementById(elId) as any;
        if (el && (el.tagName === "IMG" || el.tagName === "VIDEO")) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);

          const scaleX = canvas.width / previewW;
          const scaleY = canvas.height / previewH;
          const absTranslateX = (clip.translateX || 0) * scaleX;
          const absTranslateY = (clip.translateY || 0) * scaleY;

          ctx.translate(absTranslateX, absTranslateY);
          ctx.rotate(((clip.rotation || 0) * Math.PI) / 180);
          ctx.scale(clip.scale ?? 1, clip.scale ?? 1);

          const imgW = el.videoWidth || el.naturalWidth || canvas.width;
          const imgH = el.videoHeight || el.naturalHeight || canvas.height;
          if (imgW && imgH) {
            const imgRatio = imgW / imgH;
            const canvasRatio = canvas.width / canvas.height;
            let drawWidth, drawHeight;
            if (imgRatio > canvasRatio) {
              drawHeight = canvas.height;
              drawWidth = canvas.height * imgRatio;
            } else {
              drawWidth = canvas.width;
              drawHeight = canvas.width / imgRatio;
            }
            ctx.drawImage(
              el,
              -drawWidth / 2,
              -drawHeight / 2,
              drawWidth,
              drawHeight,
            );
          }
          ctx.restore();
        }
      }
      rAF = requestAnimationFrame(drawFn);
    };
    rAF = requestAnimationFrame(drawFn);
  };

  const handleBackToHome = () => {
    // Save project
    showToast("Project saved successfully!");
    setIsPlaying(false);
    setCurrentScreen("home");
    setActiveProjectId(null);
  };

  const createProject = (ratio: string) => {
    const newProjectId = Math.random().toString(36).substring(2, 9);
    const newProject: Project = {
      id: newProjectId,
      name: "New Project",
      ratio,
      updatedAt: "Just now",
      duration: "00:00",
      size: "0 MB",
      thumbnail:
        "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&q=80&w=300",
      layers: [],
      clips: [],
    };

    setProjects((prev) => {
      const updated = [newProject, ...prev];
      set("ai_studio_video_projects", updated).catch(console.error);
      return updated;
    });

    setActiveProjectId(newProjectId);
    setCurrentProjectRatio(ratio);
    setLayers([]);
    setClips([]);
    setCurrentTime(0);
    setZoomLevel(1);
    setCurrentScreen("editor");
  };

  const duplicateProject = (project: Project) => {
    const newProject = {
      ...project,
      id: Math.random().toString(36).substring(7),
      name: `${project.name} (Copy)`,
      lastEdited: new Date().toISOString(),
    };
    setProjects((prev) => {
      const updated = [newProject, ...prev];
      set("ai_studio_video_projects", updated).catch(console.error);
      return updated;
    });
    setProjectMenuOpenId(null);
    showToast("Project duplicated");
  };

  const confirmDeleteProject = () => {
    if (!projectToDelete) return;
    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== projectToDelete);
      set("ai_studio_video_projects", updated).catch(console.error);
      return updated;
    });
    setProjectToDelete(null);
    showToast("Project deleted");
  };

  const openProject = async (project: Project) => {
    setActiveProjectId(project.id);
    setCurrentProjectRatio(project.ratio);
    setLayers(project.layers || []);

    const updatedClips = await Promise.all((project.clips || []).map(async (clip) => {
      if (clip.fileId) {
        if (clip.src.startsWith('blob:')) {
          try {
            const res = await fetch(clip.src);
            if (res.ok) return clip;
          } catch (e) {}
        }
        
        // Load from IDB
        try {
          const file = await get(clip.fileId);
          if (file) {
            return { ...clip, src: URL.createObjectURL(file) };
          }
        } catch (e) {
          console.error("Failed to restore file from IDB", e);
        }
      }
      return clip;
    }));

    setClips(updatedClips);
    setCurrentTime(0);
    setZoomLevel(1);
    setCurrentScreen("editor");
  };

  // Auto-save
  useEffect(() => {
    if (currentScreen === "editor" && activeProjectId) {
      setProjects((prev) => {
        const updated = prev.map((p) => {
          if (p.id === activeProjectId) {
            // compute max duration
            let maxDuration = 0;
            for (const c of clips) {
              if (c.leftSeconds + c.durationSeconds > maxDuration) {
                maxDuration = c.leftSeconds + c.durationSeconds;
              }
            }

            return {
              ...p,
              ratio: currentProjectRatio,
              layers,
              clips,
              updatedAt: "Just now",
              duration: formatTime(maxDuration),
            };
          }
          return p;
        });
        // We debounce IDB save slightly or just write it
        set("ai_studio_video_projects", updated).catch(console.error);
        return updated;
      });
    }
  }, [layers, clips, currentProjectRatio, activeProjectId, currentScreen]);

  const addMediaClip = (
    id: string,
    type: "video" | "audio" | "image",
    src: string,
    duration: number,
    startAtTime: number,
    fileId?: string,
  ) => {
    const newLayerId = "L_" + id;
    setLayers((prev) => {
      if (prev.some(l => l.id === newLayerId)) return prev;
      const maxOrder = prev.reduce((max, l) => Math.max(max, l.order), -1);
      return [
        ...prev,
        {
          id: newLayerId,
          order: maxOrder + 1,
          isHidden: false,
          isMuted: false,
        },
      ];
    });

    setClips((prev) => {
      if (prev.some(c => c.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          layerId: newLayerId,
          type,
          src,
          fileId,
          leftSeconds: startAtTime,
          durationSeconds: duration,
          trimStartSeconds: 0,
        },
      ];
    });
  };

  const handleAddText = () => {
    const startAtTime = currentTime;
    const duration = 5;
    const newLayerId = "L_" + Math.random().toString(36).substring(2, 9);

    setLayers((prev) => {
      if (prev.some(l => l.id === newLayerId)) return prev;
      const minOrder =
        prev.length > 0 ? Math.min(...prev.map((l) => l.order)) : 0;
      return [
        ...prev,
        {
          id: newLayerId,
          order: minOrder - 1,
          isMuted: false,
          isHidden: false,
        },
      ];
    });

    const newTextId = "T_" + Math.random().toString(36).substring(2, 9);
    setClips((prev) => {
      if (prev.some(c => c.id === newTextId)) return prev;
      return [
        ...prev,
        {
          id: newTextId,
          layerId: newLayerId,
          type: "text",
          src: "",
          text: "New Text",
          color: "#ffffff",
          fontSize: 48,
          leftSeconds: startAtTime,
          durationSeconds: duration,
          trimStartSeconds: 0,
        },
      ];
    });
    setSelectedClipId(newTextId);
    setActiveExpandedMenu("text");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let type: "video" | "image" | "audio" = "video";
    if (file.type.startsWith("image/")) type = "image";
    if (file.type.startsWith("audio/")) type = "audio";

    const fileId = Math.random().toString(36).substring(2, 15);
    try {
      await set(fileId, file);
    } catch (err) {
      console.error("Failed to save file to IndexedDB", err);
    }

    const src = URL.createObjectURL(file);
    const id = Math.random().toString(36).substring(2, 9);
    const startAtTime = currentTime;

    if (type === "video" || type === "audio") {
      const media =
        type === "video"
          ? document.createElement("video")
          : document.createElement("audio");
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        addMediaClip(id, type, src, media.duration || 10, startAtTime, fileId);
      };
      media.src = src;
    } else {
      addMediaClip(id, type, src, 5, startAtTime, fileId);
    }
  };

  const deleteSelectedClip = () => {
    if (selectedClipIds.length > 0) {
      setClips((prev) => prev.filter((c) => !selectedClipIds.includes(c.id)));
      setSelectedClipIds([]);
      // Optional: Cleanup empty layers
    }
  };

  const handleToggleKeyframe = useCallback(() => {
    if (!selectedClipId) return;
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      const timeInClip = currentTime - c.leftSeconds;
      const keyframes = c.keyframes || [];
      
      const existingIndex = keyframes.findIndex(k => Math.abs(k.timeOffset - timeInClip) < 0.05);
      if (existingIndex >= 0) {
        return {
          ...c,
          keyframes: keyframes.filter((_, i) => i !== existingIndex)
        };
      } else {
        const newKeyframe: Keyframe = {
          id: "kf_" + Date.now() + Math.random(),
          timeOffset: timeInClip,
          properties: {
            volume: c.volume,
            translateX: c.translateX,
            translateY: c.translateY,
            rotation: c.rotation,
            scale: c.scale,
            opacity: c.opacity,
          },
          curve: "linear",
        };
        
        return {
          ...c,
          keyframes: [...keyframes, newKeyframe].sort((a, b) => a.timeOffset - b.timeOffset)
        };
      }
    }));
  }, [selectedClipId, currentTime]);

  const splitSelectedClip = () => {
    if (!selectedClipId) return;

    const newClipId = "C_" + Math.random().toString(36).substring(2, 9);

    setClips((prev) => {
      const clip = prev.find((c) => c.id === selectedClipId);
      if (!clip) return prev;

      const isWithin =
        currentTime > clip.leftSeconds &&
        currentTime < clip.leftSeconds + clip.durationSeconds;
      if (!isWithin) return prev; // Avoid second trigger in Strict Mode

      const firstDuration = currentTime - clip.leftSeconds;
      
      const rest = prev.filter((c) => c.id !== selectedClipId);
      const newClip1 = {
        ...clip,
        durationSeconds: firstDuration,
      };
      const newClip2 = {
        ...clip,
        id: newClipId,
        leftSeconds: currentTime,
        trimStartSeconds: clip.trimStartSeconds + firstDuration,
        durationSeconds: clip.durationSeconds - firstDuration,
      };
      return [...rest, newClip1, newClip2];
    });
  };

  const formatTime = (seconds: number) => {
    const s = Math.max(0, seconds);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCopy = () => {
    const clipToCopy = clips.find((c) => c.id === selectedClipId);
    if (clipToCopy) {
      setCopiedClip(clipToCopy);
      setToastMessage("Clip copied");
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  const handleExtractAudio = () => {
    const videoClip = clips.find(c => c.id === selectedClipId && c.type === "video");
    if (!videoClip) return;

    const newClipId = "C_" + Math.random().toString(36).substring(2, 9);
    const newLayerId = "L_AUDIO_" + Math.random().toString(36).substring(2, 9);
    
    setLayers(prevLayers => {
      // Find the minimum layer order to place the new audio layer below it
      const minOrder = prevLayers.length > 0 ? Math.min(...prevLayers.map(l => l.order)) : 0;
      
      const newLayer: Layer = {
        id: newLayerId,
        order: minOrder - 1,
        isHidden: false,
        isMuted: false,
      };
      
      return [...prevLayers, newLayer];
    });

    setClips(prevClips => {
      if (prevClips.some(c => c.id === newClipId)) return prevClips;

      const audioClip: Clip = {
         ...videoClip,
         id: newClipId,
         layerId: newLayerId,
         type: "audio"
      };
      // Also mute the original video clip
      const modifiedVideos = prevClips.map(c => c.id === videoClip.id ? { ...c, volume: 0 } : c);
      return [...modifiedVideos, audioClip];
    });
    
    setToastMessage("Audio extracted to new layer");
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handlePaste = () => {
    if (!copiedClip || !pastePopup) return;

    // Assign unique IDs per function call
    const currentMsId = Date.now().toString();
    const newTargetLayerId = currentMsId + "_L";

    let targetLayerId = pastePopup.layerId;

    if (!targetLayerId) {
      setLayers((prevLayers) => {
        const maxOrder = prevLayers.reduce((max, l) => Math.max(max, l.order), 0);
        return [
          ...prevLayers,
          {
            id: newTargetLayerId,
            order: maxOrder + 1,
            isMuted: false,
            isHidden: false,
            name: "Layer " + (prevLayers.length + 1)
          },
        ];
      });
      targetLayerId = newTargetLayerId;
    }

    let targetTime = pastePopup.time;

    setClips((prevClips) => {
      // Prevent Strict Mode duplicate pastes for the same unique ID
      if (prevClips.some(c => c.id === currentMsId)) return prevClips;

      const layerClips = prevClips.filter((c) => c.layerId === targetLayerId);

      // Check if targetTime overlaps any existing clip on this layer
      const overlappingClip = layerClips.find(
        (c) =>
          targetTime >= c.leftSeconds &&
          targetTime < c.leftSeconds + c.durationSeconds,
      );

      let adjustedTime = targetTime;
      if (overlappingClip) {
        const midPoint =
          overlappingClip.leftSeconds + overlappingClip.durationSeconds / 2;
        if (targetTime < midPoint) {
          adjustedTime = overlappingClip.leftSeconds - copiedClip.durationSeconds;
          if (adjustedTime < 0) adjustedTime = 0;
        } else {
          adjustedTime =
            overlappingClip.leftSeconds + overlappingClip.durationSeconds;
        }
      }

      const newClip: Clip = {
        ...copiedClip,
        id: currentMsId, // use generated ID
        layerId: targetLayerId as string,
        leftSeconds: Math.max(0, adjustedTime),
      };

      return [...prevClips, newClip];
    });

    setPastePopup(null);
    setToastMessage("Clip pasted");
    setTimeout(() => setToastMessage(null), 2000);
  };

  const toggleLayerMute = (layerId: string) => {
    setLayers((l) =>
      l.map((layer) =>
        layer.id === layerId ? { ...layer, isMuted: !layer.isMuted } : layer,
      ),
    );
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers((l) =>
      l.map((layer) =>
        layer.id === layerId ? { ...layer, isHidden: !layer.isHidden } : layer,
      ),
    );
  };

  const handleLayerPointerDown = (e: React.PointerEvent, layerId: string) => {
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    let startY = e.clientY;
    hasDraggedLayerRef.current = false;
    let hasMoved = false;
    let pendingSteps = 0;
    
    setDraggingLayerId(layerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      if (Math.abs(deltaY) > 5) {
        hasMoved = true;
        hasDraggedLayerRef.current = true;
      }

      if (hasMoved) {
        const expectedSteps =
          deltaY > 0 ? Math.floor(deltaY / 40) : Math.ceil(deltaY / 40);
        if (expectedSteps !== 0 && expectedSteps !== pendingSteps) {
          const stepDiff = expectedSteps - pendingSteps;
          pendingSteps = expectedSteps;

          setLayers((prev) => {
            const sorted = [...prev].sort((a, b) => b.order - a.order);
            const visIdx = sorted.findIndex((l) => l.id === layerId);
            const targetVisIdx = visIdx + stepDiff;

            if (targetVisIdx >= 0 && targetVisIdx < sorted.length) {
              const targetLayer = sorted[targetVisIdx];
              const clone = [...prev];
              const l1 = clone.findIndex((l) => l.id === layerId);
              const l2 = clone.findIndex((l) => l.id === targetLayer.id);

              const tempOrder = clone[l1].order;
              clone[l1].order = clone[l2].order;
              clone[l2].order = tempOrder;

              startY = moveEvent.clientY;
              pendingSteps = 0;
              return clone;
            }
            return prev;
          });
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch (err) {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      setDraggingLayerId(null);
      // Removed the custom menu opening logic to avoid conflict with onClick
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const currentPixelsPerSecondRef = useRef(pixelsPerSecond);
  useEffect(() => {
    currentPixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsPerSecond]);

  const currentZoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    currentZoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // --- Pinch/Wheel to Zoom ---
  useEffect(() => {
    const container = timelineScrollRef.current;
    if (!container) return;

    let initialDist: number | null = null;
    let initialZoom = 1;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        initialZoom = currentZoomLevelRef.current;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist !== null) {
        e.preventDefault(); // prevent native scroll
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const scale = dist / initialDist;
        setZoomLevel(Math.min(Math.max(0.2, initialZoom * scale), 10));
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialDist = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        setZoomLevel((prev) =>
          Math.min(Math.max(0.2, prev * Math.exp(delta)), 10),
        );
      }
    };

    container.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("wheel", handleWheel);
    };
  }, [currentScreen]);

  const handlePreviewElementPointerDown = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialTranslateX = clip.translateX || 0;
    const initialTranslateY = clip.translateY || 0;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id
            ? { ...c, translateX: initialTranslateX + deltaX, translateY: initialTranslateY + deltaY }
            : c
        )
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch (err) {}
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const handleClipDragStart = (e: React.PointerEvent, clip: Clip) => {
    e.stopPropagation();
    setIsPlaying(false);

    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    let activeSelectedIds = selectedClipIds;
    if (!selectedClipIds.includes(clip.id)) {
      activeSelectedIds = [clip.id];
      setSelectedClipIds(activeSelectedIds);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const initialLeftSeconds = clip.leftSeconds;
    
    // Map of initial states for ALL selected clips
    const initialClipsData = new Map<string, { left: number, layer: string }>();
    clips.forEach(c => {
      if (activeSelectedIds.includes(c.id)) {
        initialClipsData.set(c.id, { left: c.leftSeconds, layer: c.layerId });
      }
    });

    const initialScrollLeft = timelineScrollRef.current?.scrollLeft || 0;
    const initialScrollTop = timelineScrollRef.current?.scrollTop || 0;

    let isDraggingMode = false;
    let dragTimeout = setTimeout(() => {
      isDraggingMode = true;
    }, 400); // 400ms hold delay to drag

    let isCreatingLayer = false;
    let fallbackLayerId = clip.layerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (!isDraggingMode) {
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
          clearTimeout(dragTimeout);
          if (timelineScrollRef.current) {
            timelineScrollRef.current.scrollLeft = initialScrollLeft - deltaX;
            timelineScrollRef.current.scrollTop = initialScrollTop - deltaY;
          }
        }
        return;
      }

      const deltaSeconds = deltaX / currentPixelsPerSecondRef.current;
      let newLeftSeconds = initialLeftSeconds + deltaSeconds;

      // --- MAGNETIC SNAPPING (Only snap the clip being dragged) ---
      const SNAP_THRESHOLD_SECONDS = 15 / currentPixelsPerSecondRef.current;
      let minDistance = SNAP_THRESHOLD_SECONDS;
      let snappedLeftSeconds = newLeftSeconds;

      const snapPoints = [0, currentTime];
      clips.forEach((c) => {
        if (!activeSelectedIds.includes(c.id)) {
          snapPoints.push(c.leftSeconds);
          snapPoints.push(c.leftSeconds + c.durationSeconds);
        }
      });

      snapPoints.forEach(sp => {
         const distLeft = Math.abs(sp - newLeftSeconds);
         if (distLeft < minDistance) {
             minDistance = distLeft;
             snappedLeftSeconds = sp;
         }
         const newRight = newLeftSeconds + clip.durationSeconds;
         const distRight = Math.abs(sp - newRight);
         if (distRight < minDistance) {
             minDistance = distRight;
             snappedLeftSeconds = sp - clip.durationSeconds;
         }
      });
      newLeftSeconds = snappedLeftSeconds;
      
      const finalDeltaSeconds = newLeftSeconds - initialLeftSeconds;

      // Handle layer dropping ONLY if a single clip is selected
      let targetLayerId = fallbackLayerId;
      if (activeSelectedIds.length === 1) {
        const elementsUnder = document.elementsFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const trackEl = elementsUnder.find((el) =>
          el.classList.contains("track-space"),
        );
        const timelineInner = elementsUnder.find(
          (el) => el.id === "timeline-inner",
        );

        if (trackEl) {
          targetLayerId = trackEl.getAttribute("data-layer-id") || fallbackLayerId;
        } else if (timelineInner && !isCreatingLayer) {
          // Create layer
          isCreatingLayer = true;
          const newId = Math.random().toString(36).substring(7);
          setLayers((prev) => {
            const minOrder = prev.length > 0 ? Math.min(...prev.map((l) => l.order)) : 0;
            return [...prev, { id: newId, order: minOrder - 1, isMuted: false, isHidden: false }];
          });
          targetLayerId = newId;
          setTimeout(() => { isCreatingLayer = false; }, 200);
        }
      }

      setClips((prevClips) => {
        // Evaluate horizontal bounds to prevent crossing x=0
        let effectiveDelta = finalDeltaSeconds;
        let minLeft = Infinity;
        activeSelectedIds.forEach(id => {
          const init = initialClipsData.get(id);
          if (init && init.left + effectiveDelta < 0) {
            effectiveDelta = -init.left;
          }
        });

        if (activeSelectedIds.length === 1) {
          // Single clip check for overlaps with targetLayerId
          const hasOverlap = prevClips.some(
            (c) =>
              c.layerId === targetLayerId &&
              !activeSelectedIds.includes(c.id) &&
              initialLeftSeconds + effectiveDelta < c.leftSeconds + c.durationSeconds &&
              initialLeftSeconds + effectiveDelta + clip.durationSeconds > c.leftSeconds,
          );

          let finalLayerId = targetLayerId;
          if (hasOverlap) finalLayerId = fallbackLayerId;
          else fallbackLayerId = targetLayerId;

          return prevClips.map((c) =>
            c.id === clip.id
              ? { ...c, leftSeconds: Math.max(0, initialLeftSeconds + effectiveDelta), layerId: finalLayerId }
              : c,
          );
        } else {
          // Multi clip - just apply delta
          return prevClips.map((c) => {
            if (activeSelectedIds.includes(c.id)) {
              const init = initialClipsData.get(c.id);
              if (init) return { ...c, leftSeconds: Math.max(0, init.left + effectiveDelta) };
            }
            return c;
          });
        }
      });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      clearTimeout(dragTimeout);
      target.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleTrimStart = (
    e: React.PointerEvent,
    clip: Clip,
    side: "left" | "right",
  ) => {
    e.stopPropagation();
    setIsPlaying(false);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const initialLeftSeconds = clip.leftSeconds;
    const initialDurationSeconds = clip.durationSeconds;
    const initialTrimStartSeconds = clip.trimStartSeconds;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      let deltaSeconds = deltaX / currentPixelsPerSecondRef.current;

      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clip.id) return c;
          
          if (side === "left") {
            let newLeft = Math.max(0, initialLeftSeconds + deltaSeconds);
            
            // Snap left edge
            const SNAP_THRESHOLD_SECONDS = 15 / currentPixelsPerSecondRef.current;
            let minDistance = SNAP_THRESHOLD_SECONDS;
            let snappedLeft = newLeft;
            const snapPoints = [0, currentTime];
            prev.forEach(other => {
              if (other.id !== clip.id) {
                snapPoints.push(other.leftSeconds);
                snapPoints.push(other.leftSeconds + other.durationSeconds);
              }
            });
            snapPoints.forEach(sp => {
              const dist = Math.abs(sp - newLeft);
              if (dist < minDistance) {
                minDistance = dist;
                snappedLeft = sp;
              }
            });
            newLeft = snappedLeft;

            const change = newLeft - initialLeftSeconds;
            const newDuration = Math.max(0.5, initialDurationSeconds - change);
            if (initialDurationSeconds - change < 0.5) return c; // Clamp
            return {
              ...c,
              leftSeconds: newLeft,
              durationSeconds: newDuration,
              trimStartSeconds: Math.max(0, initialTrimStartSeconds + change),
            };
          } else {
            let newDuration = Math.max(
              0.5,
              initialDurationSeconds + deltaSeconds,
            );
            
            // Snap right edge
            let newRight = initialLeftSeconds + newDuration;
            const SNAP_THRESHOLD_SECONDS = 15 / currentPixelsPerSecondRef.current;
            let minDistance = SNAP_THRESHOLD_SECONDS;
            let snappedRight = newRight;
            const snapPoints = [currentTime];
            prev.forEach(other => {
              if (other.id !== clip.id) {
                snapPoints.push(other.leftSeconds);
                snapPoints.push(other.leftSeconds + other.durationSeconds);
              }
            });
            snapPoints.forEach(sp => {
              const dist = Math.abs(sp - newRight);
              if (dist < minDistance) {
                minDistance = dist;
                snappedRight = sp;
              }
            });
            newDuration = Math.max(0.5, snappedRight - initialLeftSeconds);

            return { ...c, durationSeconds: newDuration };
          }
        }),
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      (upEvent.target as HTMLElement).releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // Calculate max timeline duration from clips
  const maxTimelineDuration = useMemo(() => {
    let max = 0;
    clips.forEach((c) => {
      if (c.leftSeconds + c.durationSeconds > max)
        max = c.leftSeconds + c.durationSeconds;
    });
    return Math.max(max + 10, 30); // At least 30s buffer, always buffer + 10s
  }, [clips]);

  const visibleLayers = [...layers].sort((a, b) => b.order - a.order);

  // --- RENDERING ---
  const handleCreateProject = (r: string) => {
    setSelectedRatioTransition(r);
    setTimeout(() => {
      createProject(r);
      setIsCreatingProject(false);
      setSelectedRatioTransition(null);
    }, 400);
  };

  const handleMoveFlowBarItem = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === flowBarOrder.length - 1) return;
    
    setFlowBarOrder((prev) => {
      const newOrder = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      const temp = newOrder[index];
      newOrder[index] = newOrder[targetIndex];
      newOrder[targetIndex] = temp;
      set("ai_studio_video_flowbar_order", newOrder).catch(console.error);
      return newOrder;
    });
  };

  const getFlowBarItemLabel = (key: string) => {
    switch (key) {
      case 'volume': return 'Volume';
      case 'text': return 'Text';
      case 'crop': return 'Crop';
      case 'adjust': return 'Adjust';
      case 'speed': return 'Speed';
      case 'copy': return 'Copy';
      case 'move': return 'Move';
      case 'magic': return 'Magic';
      case 'activity': return 'Blend & Opacity';
      case 'mask': return 'Mask Shape';
      default: return key;
    }
  };

  const renderSettings = () => (
    <div className="flex flex-col h-screen w-full bg-[#121212] overflow-hidden relative">
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 scrollbar-hide">
        <div className="min-h-full flex flex-col pb-[150px]">
          {/* Header */}
          <div className="pt-32 pb-8 flex justify-between items-end mt-auto">
            <h1 className="text-[52px] font-extrabold tracking-tight leading-none text-white">
              Settings
            </h1>
            <button
              className="w-10 h-10 rounded-full hover:bg-zinc-800 flex items-center justify-center transition-colors mb-2 text-zinc-400 hover:text-white"
              onClick={() => setCurrentScreen("home")}
            >
              <ChevronLeft size={24} />
            </button>
          </div>

          {/* Settings Content */}
          <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full mt-4">
            <div className="bg-zinc-900 border border-white/5 rounded-3xl p-6">
              <h3 className="text-white font-bold mb-4 text-xl">
                Flow Bar Order
              </h3>
              <p className="text-sm text-zinc-400 mb-4 font-medium">Customize the order of tools in the floating action menu.</p>
              <div className="flex flex-col gap-2">
                {flowBarOrder.map((key, index) => (
                  <div key={key} className="flex items-center justify-between bg-zinc-800/50 rounded-xl px-4 py-3 border border-white/5">
                    <span className="text-zinc-200 font-medium text-sm">{getFlowBarItemLabel(key)}</span>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => handleMoveFlowBarItem(index, 'up')}
                        disabled={index === 0}
                        className={`p-1.5 rounded-lg transition-colors ${index === 0 ? 'opacity-30' : 'hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button 
                        onClick={() => handleMoveFlowBarItem(index, 'down')}
                        disabled={index === flowBarOrder.length - 1}
                        className={`p-1.5 rounded-lg transition-colors ${index === flowBarOrder.length - 1 ? 'opacity-30' : 'hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-zinc-900 border border-white/5 rounded-3xl p-6">
              <h3 className="text-white font-bold mb-4 text-xl">
                Export Preferences
              </h3>
              <div className="flex flex-col gap-5">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-300 font-medium text-sm">
                    Default Resolution
                  </span>
                  <select className="bg-zinc-800 text-white rounded-xl px-4 py-2 outline-none border border-white/10 text-sm focus:border-white/20 transition-colors">
                    <option>1080p</option>
                    <option>4K</option>
                    <option>720p</option>
                  </select>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-300 font-medium text-sm">
                    Default FPS
                  </span>
                  <select className="bg-zinc-800 text-white rounded-xl px-4 py-2 outline-none border border-white/10 text-sm focus:border-white/20 transition-colors">
                    <option>30 fps</option>
                    <option>60 fps</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-white/5 rounded-3xl p-6">
              <h3 className="text-white font-bold mb-4 text-xl">App Info</h3>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 text-sm font-medium">
                    Version
                  </span>
                  <span className="text-zinc-500 font-mono text-sm">1.0.0</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 text-sm font-medium">
                    Developer
                  </span>
                  <span className="text-zinc-500 text-sm">AI Studio</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="flex flex-col h-screen w-full bg-[#121212] overflow-hidden relative">
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 scrollbar-hide">
        <div className="min-h-full flex flex-col pb-[150px]">
          {/* Header - One UI style */}
          <div className="pt-32 pb-8 flex justify-between items-end mt-auto">
            <h1 className="text-[52px] font-extrabold tracking-tight leading-none text-white">
              Projects
            </h1>
            <button
              className="w-10 h-10 rounded-full hover:bg-zinc-800 flex items-center justify-center transition-colors mb-2 text-zinc-400 hover:text-white"
              onClick={() => setCurrentScreen("settings")}
            >
              <Settings size={22} />
            </button>
          </div>

          {/* Project List */}
          <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
            {projects.map((p) => (
              <div
                key={p.id}
                className="relative h-[120px] rounded-[32px] cursor-pointer bg-zinc-900 border border-white/5 flex transition-transform active:scale-[0.98] group"
                onClick={() => openProject(p)}
              >
                <div className="w-[120px] shrink-0 relative overflow-hidden rounded-l-[32px]">
                  <img
                    src={p.thumbnail}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-zinc-900"></div>
                </div>
                <div className="flex-1 py-5 px-3 flex flex-col justify-center relative">
                  <h3 className="font-bold text-lg text-white mb-0.5">
                    {p.name}
                  </h3>
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                      <Clock size={12} /> {p.duration}
                    </span>
                    <span className="text-[11px] font-medium text-zinc-500 flex items-center gap-1.5">
                      <Save size={12} /> {p.size}
                    </span>
                  </div>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">
                    <button
                      className="w-8 h-8 rounded-full hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectMenuOpenId(
                          projectMenuOpenId === p.id ? null : p.id,
                        );
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {projectMenuOpenId === p.id && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectMenuOpenId(null);
                          }}
                        />
                        <div className="absolute right-0 top-full mt-2 w-36 bg-zinc-800 rounded-xl shadow-xl border border-white/10 overflow-hidden z-50">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateProject(p);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2"
                          >
                            <Copy size={14} /> Duplicate
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectToDelete(p.id);
                              setProjectMenuOpenId(null);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-2"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Action Menu for Home */}
      <div className="absolute bottom-10 left-0 right-0 flex justify-center px-6 z-[60] pointer-events-none">
        <AnimatePresence mode="popLayout">
          {!isCreatingProject ? (
            <motion.div
              key="new-project"
              role="button"
              layoutId="new-project-btn"
              transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
              onClick={() => setIsCreatingProject(true)}
              className="cursor-pointer pointer-events-auto flex justify-center items-center gap-3 shadow-[0_8px_30px_rgb(0,0,0,0.5)] active:scale-[0.98] w-full max-w-[320px] h-[60px] bg-white rounded-[30px] text-black font-extrabold text-lg border border-white/10"
            >
              <PlusIcon size={24} strokeWidth={3} className="shrink-0" />
              <span>New Project</span>
            </motion.div>
          ) : (
            <motion.div
              key="create-project"
              role="button"
              layoutId="new-project-btn"
              transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
              onClick={() => handleCreateProject(focusedRatio)}
              className="cursor-pointer pointer-events-auto flex justify-center items-center gap-3 shadow-[0_8px_30px_rgb(0,0,0,0.5)] active:scale-[0.98] w-[140px] h-[60px] bg-[#252528] rounded-[30px] text-white font-bold text-base border border-white/5"
            >
              <span>Create</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ratio Selection Overlay */}
      <AnimatePresence>
        {isCreatingProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute inset-0 z-50 bg-black/85 backdrop-blur-[8px] flex flex-col items-center justify-center"
          >
            <motion.button
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-8 right-8 w-12 h-12 rounded-full bg-zinc-800/80 backdrop-blur hover:bg-zinc-700 flex items-center justify-center text-white transition-colors z-50"
              onClick={() => setIsCreatingProject(false)}
            >
              <X size={24} />
            </motion.button>

            <motion.h2
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
              className="text-3xl font-extrabold mb-8 text-white"
            >
              Choose Format
            </motion.h2>

            <div className="flex gap-6 items-end overflow-x-auto w-full px-[calc(50vw-60px)] sm:px-[calc(50vw-180px)] md:justify-center md:px-8 pt-16 pb-12 scrollbar-hide snap-x snap-mandatory">
              {[
                { ratio: "9:16", w: 100, h: 178, label: "Reels, TikTok" },
                { ratio: "16:9", w: 178, h: 100, label: "YouTube" },
                { ratio: "1:1", w: 140, h: 140, label: "Instagram" },
              ].map((r, i) => (
                <motion.div
                  key={r.ratio}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.7,
                    delay: i * 0.1 + 0.15,
                    type: "spring",
                    bounce: 0.4,
                  }}
                  className="flex flex-col items-center gap-5 cursor-pointer group snap-center shrink-0"
                  onClick={() => {
                    if (focusedRatio === r.ratio) {
                      handleCreateProject(r.ratio);
                    } else {
                      setFocusedRatio(r.ratio);
                    }
                  }}
                >
                  <motion.div
                    layoutId={
                      selectedRatioTransition === r.ratio
                        ? "preview-screen"
                        : undefined
                    }
                    className={`border-[3px] rounded-[24px] flex items-center justify-center bg-zinc-900 group-hover:bg-zinc-800 transition-all duration-300 ${focusedRatio === r.ratio ? "border-white bg-zinc-800 scale-105" : "border-zinc-700 group-hover:border-zinc-500 hover:scale-105"}`}
                    style={{ width: r.w, height: r.h }}
                  >
                    <span
                      className={`font-bold text-lg transition-colors ${focusedRatio === r.ratio ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`}
                    >
                      {r.ratio}
                    </span>
                  </motion.div>
                  <span
                    className={`text-sm font-semibold transition-colors ${focusedRatio === r.ratio ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`}
                  >
                    {r.label}
                  </span>
                </motion.div>
              ))}
            </div>
            {/* Spacer for bottom create button */}
            <div className="h-24"></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {projectToDelete && (
          <div
            className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setProjectToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#252528] border border-white/10 rounded-[32px] p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-white mb-2">
                Delete Project
              </h3>
              <p className="text-zinc-400 text-sm mb-6 font-medium">
                Are you sure you want to delete this project? This action cannot
                be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  className="px-5 py-2.5 rounded-full text-sm font-bold text-white hover:bg-zinc-700 transition-colors"
                  onClick={() => setProjectToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-5 py-2.5 bg-red-500 hover:bg-red-600 rounded-full text-sm font-bold text-white transition-colors"
                  onClick={confirmDeleteProject}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderEditor = () => (
    <div className="flex flex-col h-screen w-full bg-[#1e1e20] overflow-hidden">
      {/* Exporting Overlay */}
      {isExporting && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-md bg-zinc-900 rounded-3xl p-6 border border-white/10 flex flex-col items-center">
            <div className="text-white font-bold text-lg mb-2">
              Exporting Video...
            </div>
            <div className="text-zinc-400 text-sm mb-6">
              Please do not close this window
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              ></div>
            </div>
            <div className="text-white font-mono text-xs mt-3">
              {exportProgress}%
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="flex justify-between items-center px-4 py-4 shrink-0 bg-black/20 relative z-[80]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackToHome}
            className="w-10 h-10 rounded-full hover:bg-zinc-800 flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="bg-zinc-800 text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-wider hover:bg-zinc-700 cursor-pointer">
            {currentProjectRatio}
          </div>
        </div>
        <div className="flex items-center space-x-2 z-50">
          <div className="relative">
            <button
              onClick={() => setIsExportExpanded(!isExportExpanded)}
              className="bg-white text-black px-6 h-[40px] rounded-full text-[13px] font-bold shadow hover:bg-zinc-200 transition-colors whitespace-nowrap"
            >
              EXPORT
            </button>

            <AnimatePresence>
              {isExportExpanded && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  className="absolute top-[calc(100%+8px)] right-0 bg-zinc-800 border border-white/10 shadow-2xl rounded-2xl w-[200px] flex flex-col p-2 z-50 origin-top-right overflow-hidden"
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] font-semibold text-white/50">
                      Resolution
                    </span>
                    <select
                      className="bg-transparent text-white text-[11px] font-semibold outline-none cursor-pointer hover:text-yellow-400 transition-colors text-right"
                      value={exportResolution}
                      onChange={(e) => setExportResolution(e.target.value)}
                    >
                      <option value="1080p" className="bg-zinc-800 text-white">
                        1080p
                      </option>
                      <option value="2K" className="bg-zinc-800 text-white">
                        2K
                      </option>
                      <option value="4K" className="bg-zinc-800 text-white">
                        4K
                      </option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] font-semibold text-white/50">
                      Frame Rate
                    </span>
                    <select
                      className="bg-transparent text-white text-[11px] font-semibold outline-none cursor-pointer hover:text-yellow-400 transition-colors text-right"
                      value={exportFps}
                      onChange={(e) => setExportFps(e.target.value)}
                    >
                      <option value="24" className="bg-zinc-800 text-white">
                        24 fps
                      </option>
                      <option value="30" className="bg-zinc-800 text-white">
                        30 fps
                      </option>
                      <option value="60" className="bg-zinc-800 text-white">
                        60 fps
                      </option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 mb-2">
                    <span className="text-[11px] font-semibold text-white/50">
                      Bitrate
                    </span>
                    <select
                      className="bg-transparent text-white text-[11px] font-semibold outline-none cursor-pointer hover:text-yellow-400 transition-colors text-right"
                      value={exportBitrate}
                      onChange={(e) => setExportBitrate(e.target.value)}
                    >
                      <option value="Smart" className="bg-zinc-800 text-white">
                        Smart
                      </option>
                      <option value="High" className="bg-zinc-800 text-white">
                        High
                      </option>
                      <option value="Max" className="bg-zinc-800 text-white">
                        Max
                      </option>
                    </select>
                  </div>
                  <div className="flex flex-col px-3 py-2 border-t border-white/10 mb-2">
                    <span className="text-[11px] font-semibold text-white/90 mb-1">
                      Frame Interpolation
                    </span>
                    <label className="flex items-center justify-between cursor-pointer group mt-1">
                      <span className="text-[10px] text-white/50 group-hover:text-white/80 transition-colors">
                        Smooth Slow-Mo (Optical Flow)
                      </span>
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={exportOpticalFlow}
                          onChange={(e) =>
                            setExportOpticalFlow(e.target.checked)
                          }
                        />
                        <div className="w-7 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"></div>
                      </div>
                    </label>
                  </div>
                  <button
                    onClick={startExport}
                    className="w-full bg-white text-black py-2.5 rounded-xl text-[11px] font-bold shadow hover:bg-zinc-200 transition-colors active:scale-95 mt-1"
                  >
                    Start Export
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Preview Area */}
      <main className="flex-1 min-h-0 flex flex-col pt-2 pb-4 relative z-[80] bg-[#1e1e20]">
        <div className="flex-1 min-h-0 relative flex items-center justify-center px-4">
          <div className="relative w-full h-full flex items-center justify-center">
            <svg
              viewBox={`0 0 ${currentProjectRatio.split(":")[0]} ${currentProjectRatio.split(":")[1]}`}
              className="max-w-full max-h-full h-[100%] pointer-events-none opacity-0"
            />
            <motion.div
              id="preview-screen"
              layoutId="preview-screen"
              className="absolute top-0 bottom-0 left-0 right-0 m-auto bg-black rounded-3xl overflow-hidden shadow-[20px_20px_60px_rgba(0,0,0,0.5)] border border-white/10"
              style={{
                aspectRatio: currentProjectRatio.replace(":", "/"),
                maxHeight: "100%",
                maxWidth: "100%",
              }}
            >
            {/* Media Rendering */}
            {[...visibleLayers].reverse().map((layer) => {
              if (layer.isHidden) return null;
              const layerClips = clips.filter((c) => c.layerId === layer.id);
              // Find active clip
              const activeClipRaw = layerClips.find(
                (c) =>
                  currentTime >= c.leftSeconds &&
                  currentTime <= c.leftSeconds + c.durationSeconds,
              );

              if (!activeClipRaw) return null;

              const interpolatedProps = getInterpolatedProps(activeClipRaw, currentTime - activeClipRaw.leftSeconds);
              const activeClip = { ...activeClipRaw, ...interpolatedProps };

              const getClipPath = (maskType?: string) => {
                switch (maskType) {
                  case "circle":
                    return "circle(50% at 50% 50%)";
                  case "square":
                    return "inset(15% 15% 15% 15%)";
                  case "rounded":
                    return "inset(5% 5% 5% 5% round 15%)";
                  default:
                    return "none";
                }
              };

              const transformStyle: React.CSSProperties = {
                transform: `translate(${activeClip.translateX || 0}px, ${activeClip.translateY || 0}px) rotate(${activeClip.rotation || 0}deg) scale(${activeClip.scale ?? 1})`,
                clipPath: getClipPath(activeClip.maskType),
                opacity: activeClip.opacity ?? 1,
                mixBlendMode: activeClip.mixBlendMode as any || "normal",
                ...(activeClip.cropRatio ? { aspectRatio: activeClip.cropRatio.replace(":", "/") } : {})
              };

              return (
                <div
                  key={layer.id}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  {erroredClips.has(activeClip.id) &&
                  activeClip.type !== "text" ? (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center bg-[#171719] border border-red-500/50 m-4 rounded-[32px] overflow-hidden"
                      style={transformStyle}
                    >
                      <AlertCircle className="text-red-500 mb-2" size={32} />
                      <span className="text-red-400 text-sm font-bold">
                        File missing
                      </span>
                    </div>
                  ) : (
                    <>
                      {activeClip.type === "text" && (
                        <div
                          id={`clip-media-${activeClip.id}`}
                          className="flex items-center justify-center w-full h-full font-sans break-words whitespace-pre-wrap text-center overflow-hidden"
                          style={{
                            ...transformStyle,
                            color: activeClip.color || "#ffffff",
                            fontSize: `${activeClip.fontSize || 48}px`,
                          }}
                        >
                          <span
                             className="pointer-events-auto cursor-pointer"
                             onPointerDown={(e) => handlePreviewElementPointerDown(e, activeClip)}>
                             {activeClip.text}
                          </span>
                        </div>
                      )}
                      {activeClip.type === "image" && (
                        <div
                          className="pointer-events-auto cursor-pointer overflow-hidden max-w-full max-h-full flex items-center justify-center relative shadow-lg"
                          onPointerDown={(e) => handlePreviewElementPointerDown(e, activeClip)}
                          style={{
                               ...transformStyle,
                               ...(activeClip.cropRatio ? {
                                  width: activeClip.cropRatio === "16:9" ? "100%" : activeClip.cropRatio === "9:16" ? "auto" : activeClip.cropRatio === "1:1" ? "auto" : "100%",
                                  height: activeClip.cropRatio ? (activeClip.cropRatio === "16:9" ? "auto" : activeClip.cropRatio === "9:16" ? "100%" : activeClip.cropRatio === "1:1" ? "100%" : "100%") : '100%',
                               } : { width: '100%', height: '100%' }),
                          }}
                        >
                          <img
                            id={`clip-media-${activeClip.id}`}
                            src={activeClip.src}
                            className="w-full h-full object-cover pointer-events-none"
                            crossOrigin="anonymous"
                            onError={() => handleClipError(activeClip.id)}
                          />
                          {activeExpandedMenu === "crop" && selectedClipId === activeClip.id && (
                             <div className="absolute inset-0 pointer-events-none border-2 border-white grid grid-cols-3 grid-rows-3 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-b border-white/40"></div>
                               <div className="border-r border-white/40"></div>
                               <div className="border-r border-white/40"></div>
                               <div></div>
                             </div>
                          )}
                        </div>
                      )}
                      {activeClip.type === "video" && (
                        <div
                          className="pointer-events-auto cursor-pointer overflow-hidden max-w-full max-h-full flex items-center justify-center relative shadow-lg"
                          onPointerDown={(e) => handlePreviewElementPointerDown(e, activeClip)}
                          style={{
                               ...transformStyle,
                               ...(activeClip.cropRatio ? {
                                  width: activeClip.cropRatio === "16:9" ? "100%" : activeClip.cropRatio === "9:16" ? "auto" : activeClip.cropRatio === "1:1" ? "auto" : "100%",
                                  height: activeClip.cropRatio ? (activeClip.cropRatio === "16:9" ? "auto" : activeClip.cropRatio === "9:16" ? "100%" : activeClip.cropRatio === "1:1" ? "100%" : "100%") : '100%',
                               } : { width: '100%', height: '100%' }),
                          }}
                        >
                          <VideoRenderer
                            id={`clip-media-${activeClip.id}`}
                            clip={activeClip}
                            currentTime={currentTime}
                            isPlaying={isPlaying}
                            isMuted={layer.isMuted}
                            className="w-full h-full object-cover pointer-events-none"
                            onError={() => handleClipError(activeClip.id)}
                          />
                          {activeExpandedMenu === "crop" && selectedClipId === activeClip.id && (
                             <div className="absolute inset-0 pointer-events-none border-2 border-white grid grid-cols-3 grid-rows-3 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] z-50">
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-r border-b border-white/40"></div>
                               <div className="border-b border-white/40"></div>
                               <div className="border-r border-white/40"></div>
                               <div className="border-r border-white/40"></div>
                               <div></div>
                             </div>
                          )}
                        </div>
                      )}
                      {activeClip.type === "audio" && (
                        <AudioRenderer
                          clip={activeClip}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          isMuted={layer.isMuted}
                          onError={() => handleClipError(activeClip.id)}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </motion.div>
          </div>
        </div>

        {/* Playback Transport Controls */}
        <div className="flex justify-between items-center shrink-0 pr-6 h-[40px] pt-4 pl-[24px] pb-[5px]">
          <div className="flex items-center gap-4">
            <span className="text-zinc-300 font-mono text-xs tracking-wider opacity-80 min-w-[50px]">
              {formatTime(currentTime)}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="w-8 h-8 bg-zinc-800 text-white rounded-full shadow flex items-center justify-center hover:bg-zinc-700 transition-colors m-0"
                onClick={() => {
                  setCurrentTime(0);
                  setPlayheadX(0);
                  playheadXRef.current = 0;
                  if (timelineScrollRef.current) {
                    timelineScrollRef.current.scrollLeft = 0;
                  }
                }}
                title="Go to Start"
              >
                <SkipBack size={14} fill="currentColor" />
              </button>
              <button
                className="w-10 h-10 bg-white text-black rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform m-0 pl-0 pr-[4px]"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" className="ml-1" />
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex bg-zinc-800 rounded-full px-1 py-1 mr-2">
              <button
                className={`p-2 rounded-full transition-colors ${selectedClipId ? "hover:bg-zinc-700 text-white" : "opacity-30"}`}
                disabled={!selectedClipId}
                onClick={handleToggleKeyframe}
              >
                <Diamond size={16} className={isAtKeyframe ? "fill-white" : ""} />
              </button>
              <button
                className={`p-2 rounded-full transition-colors ${(selectedClipId && isBetweenKeyframes) ? "hover:bg-zinc-700 text-white" : "opacity-30"}`}
                disabled={!selectedClipId || !isBetweenKeyframes}
                onClick={() => setShowKeyframeGraph(!showKeyframeGraph)}
              >
                <LineChart size={16} />
              </button>
            </div>
            <div className="flex bg-zinc-800 rounded-full px-1 py-1 mr-2">
              <button
                className={`p-2 rounded-full transition-colors ${selectedClipId ? "hover:bg-zinc-700 text-white" : "opacity-30"}`}
                disabled={!selectedClipId}
                onClick={splitSelectedClip}
              >
                <Scissors size={16} />
              </button>
              <div className="w-px bg-zinc-700 my-1 mx-1"></div>
              <button
                className={`p-2 rounded-full transition-colors ${selectedClipIds.length > 0 ? "hover:bg-zinc-700 text-white" : "opacity-30"}`}
                disabled={selectedClipIds.length === 0}
                onClick={deleteSelectedClip}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex bg-zinc-800 rounded-full px-1 py-1">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className={`p-2 rounded-full transition-colors ${historyIndex <= 0 ? "opacity-30" : "hover:bg-zinc-700"}`}
              >
                <Undo2 size={16} />
              </button>
              <div className="w-px bg-zinc-700 my-1 mx-1"></div>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className={`p-2 rounded-full transition-colors ${historyIndex >= history.length - 1 ? "opacity-30" : "hover:bg-zinc-700"}`}
              >
                <Redo2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Modern Horizontal Splitter */}
      <div className="h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent relative z-[80] bg-[#1e1e20]"></div>

      {/* Editor Timeline Space */}
      <div className="h-[250px] sm:h-[300px] shrink-0 bg-[#171719] flex flex-col relative w-full select-none z-0 overflow-hidden">
        {/* Timeline Content Flex Container */}
        <div
          id="master-vertical-scroll"
          ref={timelineScrollRef}
          className="flex-1 w-full relative overflow-auto scrollbar-hide bg-[#171719]"
          style={{ touchAction: "pan-x pan-y" }}
          onScroll={(e) => {
            if (!isPlayingRef.current) {
              setCurrentTime(
                (e.currentTarget.scrollLeft + playheadXRef.current) /
                  currentPixelsPerSecondRef.current,
              );
            }
          }}
        >
          <div className="flex min-h-full min-w-max relative w-[fit-content]">
            {/* Left Layer Control Panel */}
            <div className="w-[100px] shrink-0 flex flex-col border-r border-white/5 bg-[#171719] z-[70] sticky left-0 pb-[200px] shadow-[2px_0_10px_rgba(0,0,0,0.2)]">
              <div className="text-[9px] uppercase tracking-widest text-zinc-500 text-center font-bold sticky top-0 w-full z-[80] bg-[#171719] h-[30px] flex items-center justify-center border-b border-white/5 shrink-0 shadow-[0_4px_10px_rgba(0,0,0,0.2)]">
                Layers
              </div>

              <div id="layers-sidebar" className="flex flex-col flex-1">
                {visibleLayers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`h-[52px] sm:h-[60px] flex flex-col items-center justify-center shrink-0 border-b group py-1 relative transition-all transform-gpu ${draggingLayerId === layer.id ? "bg-indigo-500/20 border-indigo-500/50 scale-[1.02] z-50 shadow-xl" : "bg-zinc-800/20 border-white/5 backdrop-blur-sm z-10"}`}
                  >
                    <div className="flex gap-0.5 sm:gap-1 items-center">
                      <button
                        onClick={() => toggleLayerMute(layer.id)}
                        className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full ${layer.isMuted ? "text-red-400 bg-red-400/10" : "text-zinc-400 hover:text-white"}`}
                      >
                        {layer.isMuted ? (
                          <VolumeX size={13} sm:size={14} />
                        ) : (
                          <Volume2 size={13} sm:size={14} />
                        )}
                      </button>
                      <button
                        onClick={() => toggleLayerVisibility(layer.id)}
                        className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full ${layer.isHidden ? "text-blue-400 bg-blue-400/10" : "text-zinc-400 hover:text-white"}`}
                      >
                        {layer.isHidden ? (
                          <EyeOff size={13} sm:size={14} />
                        ) : (
                          <Eye size={13} sm:size={14} />
                        )}
                      </button>
                      <div
                        onPointerDown={(e) =>
                          handleLayerPointerDown(e, layer.id)
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hasDraggedLayerRef.current) {
                            setLayerMenuOpenId(layerMenuOpenId === layer.id ? null : layer.id);
                          }
                        }}
                        className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full cursor-grab touch-none transition-colors ${layerMenuOpenId === layer.id || draggingLayerId === layer.id ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800"}`}
                      >
                        <MoreVertical size={13} sm:size={14} />
                      </div>
                    </div>

                    {/* Layer Options Menu */}
                    <AnimatePresence>
                      {layerMenuOpenId === layer.id && (
                        <>
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLayerMenuOpenId(null);
                            }}
                          />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: -10 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: -10 }}
                            className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[70] bg-zinc-800 border border-white/10 rounded-lg shadow-xl overflow-hidden flex flex-col w-[120px]"
                          >
                            <button
                              className="px-3 py-2 text-xs text-left text-zinc-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLayers((prev) => {
                                  const sorted = [...prev].sort(
                                    (a, b) => b.order - a.order,
                                  );
                                  const visIdx = sorted.findIndex(
                                    (l) => l.id === layer.id,
                                  );
                                  // insert new layer right above this one visually (so order is between this and the one above)
                                  let newOrder = layer.order + 0.5;
                                  if (visIdx > 0) {
                                    newOrder =
                                      (layer.order + sorted[visIdx - 1].order) /
                                      2;
                                  } else {
                                    newOrder = layer.order + 1;
                                  }
                                  return [
                                    ...prev,
                                    {
                                      id: "L_" + Date.now(),
                                      order: newOrder,
                                      isMuted: false,
                                      isHidden: false,
                                    },
                                  ];
                                });
                                setLayerMenuOpenId(null);
                              }}
                            >
                              <PlusIcon size={12} /> Add Up
                            </button>
                            <button
                              className="px-3 py-2 text-xs text-left text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLayerMenuOpenId(null);
                              }}
                            >
                              Decide Later
                            </button>
                            <button
                              className="px-3 py-2 text-xs text-left text-red-500 hover:bg-red-500/20 transition-colors flex items-center gap-2 border-t border-white/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLayers((prev) =>
                                  prev.filter((l) => l.id !== layer.id),
                                );
                                setClips((prev) =>
                                  prev.filter((c) => c.layerId !== layer.id),
                                );
                                setLayerMenuOpenId(null);
                              }}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
                <div
                  className="h-[52px] sm:h-[60px] flex items-center justify-center shrink-0 border-b border-white/5 bg-zinc-800/10 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                  onClick={() => {
                    setLayers((prev) => {
                      const maxOrder = prev.reduce(
                        (max, l) => Math.max(max, l.order),
                        -1,
                      );
                      return [
                        ...prev,
                        {
                          id: "L_" + Date.now(),
                          order: maxOrder + 1,
                          isMuted: false,
                          isHidden: false,
                        },
                      ];
                    });
                  }}
                >
                  <PlusIcon
                    size={16}
                    className="text-zinc-500 hover:text-white"
                  />
                </div>
              </div>
            </div>

            {/* STATIONARY PLAYHEAD (Now perfectly aligned) */}
            {layers.length > 0 && (
              <div
                className="sticky top-0 left-[100px] pointer-events-none z-[60] w-0 h-0"
                style={{ transform: `translateX(${playheadX}px)` }}
              >
                <div className="absolute top-0 -translate-x-[1px] flex flex-col items-center">
                  <div
                    className="w-[14px] h-[15px] bg-red-500 relative flex items-end justify-center"
                    style={{
                      clipPath:
                        "polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)",
                    }}
                  >
                    <div className="w-[4px] h-[4px] bg-red-950/30 rounded-full mb-[5px]"></div>
                  </div>
                </div>
                <div className="absolute top-0 left-0 transform -translate-x-[1px] w-[1.5px] bg-red-500 h-[100vh] shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
              </div>
            )}

            {/* Right Scrollable Timeline Container */}
            <div className="flex-1 relative flex flex-col min-w-max pt-[0px]">
              {/* sticky wrapper for Ruler */}
              {layers.length > 0 && (
                <div
                  id="ruler-container"
                  className="sticky top-0 z-[50] h-[30px] bg-[#171719] border-b border-white/5 cursor-pointer hover:bg-[#222] transition-colors"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsPlaying(false);
                    const target = e.currentTarget;
                    target.setPointerCapture(e.pointerId);

                    const updateSeek = (clientX: number) => {
                      const rx = clientX - 100;
                      const rect = target.getBoundingClientRect();
                      const x = rx + timelineScrollRef.current!.scrollLeft;
                      const newTime = Math.max(
                        0,
                        x / currentPixelsPerSecondRef.current,
                      );
                      setCurrentTime(newTime);

                      setPlayheadX(Math.max(0, rx));
                      playheadXRef.current = Math.max(0, rx);
                    };
                    updateSeek(e.clientX);

                    const handlePointerMove = (moveEvent: PointerEvent) => {
                      updateSeek(moveEvent.clientX);
                    };
                    const handlePointerUp = (upEvent: PointerEvent) => {
                      target.releasePointerCapture(upEvent.pointerId);
                      window.removeEventListener(
                        "pointermove",
                        handlePointerMove,
                      );
                      window.removeEventListener("pointerup", handlePointerUp);
                    };
                    window.addEventListener("pointermove", handlePointerMove);
                    window.addEventListener("pointerup", handlePointerUp);
                  }}
                >
                  <div
                    className="relative h-full"
                    style={{
                      width: `${maxTimelineDuration * pixelsPerSecond}px`,
                    }}
                  >
                    {Array.from({ length: Math.ceil(maxTimelineDuration) }).map(
                      (_, i) => (
                        <div
                          key={i}
                          className="absolute h-full border-l border-zinc-600/80 pointer-events-none"
                          style={{ left: `${i * pixelsPerSecond}px` }}
                        >
                          <span
                            className="absolute -left-[4px] top-[2px] text-[10px] text-zinc-300 font-medium font-mono pl-1 bg-transparent px-1 rounded line-height-none leading-none"
                            style={{ textShadow: "none" }}
                          >
                            {formatTime(i)}
                          </span>
                          {/* Sub-ticks for zoom */}
                          {Array.from({ length: 9 }).map((_, subIndex) => {
                            const isHalf = subIndex === 4;
                            return (
                              <div
                                key={subIndex}
                                className={`absolute bottom-0 w-px ${isHalf ? "bg-zinc-500" : "bg-zinc-700/80"} pointer-events-none`}
                                style={{
                                  left: `${(subIndex + 1) * (pixelsPerSecond / 10)}px`,
                                  height: isHalf ? "10px" : "5px",
                                }}
                              >
                                <span
                                  className="absolute bottom-[12px] text-[8px] text-zinc-500 font-mono"
                                  style={{
                                    transform: "translateX(-50%)",
                                    opacity: zoomLevel >= 3 ? 1 : 0,
                                    transition: "opacity 0.2s",
                                  }}
                                >
                                  {i}.{subIndex + 1}s
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
              <div
                className="w-full h-full relative"
                onPointerDown={(e) => {
                  setIsPlaying(false);
                  pointerMoveCanvasRef.current = false;
                  setPastePopup(null);

                  const target = e.target as Element;
                  const isEmptySpace =
                    e.target === e.currentTarget ||
                    target.id === "timeline-content" ||
                    target.id === "timeline-inner" ||
                    target.closest(".track-space");

                  let clickTime = currentTime;
                  const innerRect = document
                    .getElementById("timeline-inner")
                    ?.getBoundingClientRect();
                  if (innerRect) {
                    const x = e.clientX - innerRect.left;
                    clickTime = Math.max(
                      0,
                      x / currentPixelsPerSecondRef.current,
                    );
                  }

                  if (isEmptySpace) {
                    setSelectedClipId(null);

                    const startX = e.clientX;
                    const startY = e.clientY;
                    const pointerId = e.pointerId;
                    const isMouse = e.pointerType === "mouse";
                    const masterScroll = timelineScrollRef.current;
                    if (!masterScroll) return;

                    const startScrollLeft = masterScroll.scrollLeft;
                    const startScrollTop = masterScroll.scrollTop;
                    const rect = document.getElementById("timeline-inner")?.getBoundingClientRect() || {left:0, top:0};

                    const container = e.currentTarget as HTMLElement;
                    container.setPointerCapture(pointerId);

                    let hasMoved = false;
                    let isMarquee = false;

                    const handlePointerMove = (moveEvent: PointerEvent) => {
                      pointerMoveCanvasRef.current = true;
                      const deltaX = moveEvent.clientX - startX;
                      const deltaY = moveEvent.clientY - startY;

                      if (!isMarquee) {
                        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                          hasMoved = true;
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          // Only polyfill scroll for mouse, touch is native pan
                          if (isMouse) {
                            masterScroll.scrollLeft = startScrollLeft - deltaX;
                            masterScroll.scrollTop = startScrollTop - deltaY;
                          }
                        }
                      } else {
                        // Marquee Selection Mode!
                        if (!isMouse) moveEvent.preventDefault(); // attempt to stop scroll on touch if we can

                        const curX = moveEvent.clientX - rect.left + masterScroll.scrollLeft;
                        const curY = moveEvent.clientY - rect.top + masterScroll.scrollTop;
                        const absStartX = startX - rect.left + masterScroll.scrollLeft;
                        const absStartY = startY - rect.top + masterScroll.scrollTop;

                        setMarquee({ startX: absStartX, startY: absStartY, currentX: curX, currentY: curY });

                        // Check Intersections
                        const minX = Math.min(absStartX, curX);
                        const maxX = Math.max(absStartX, curX);
                        const minY = Math.min(absStartY, curY);
                        const maxY = Math.max(absStartY, curY);

                        const newSelected: string[] = [];
                        const layerMap = new Map();
                        visibleLayers.forEach((l, i) => layerMap.set(l.id, i));

                        clips.forEach(clip => {
                           const lidx = layerMap.get(clip.layerId);
                           if (lidx === undefined) return;
                           const cLeft = clip.leftSeconds * currentPixelsPerSecondRef.current;
                           const cRight = cLeft + clip.durationSeconds * currentPixelsPerSecondRef.current;
                           const cTop = 32 + lidx * 56;
                           const cBottom = cTop + 48;

                           if (cLeft < maxX && cRight > minX && cTop < maxY && cBottom > minY) {
                               newSelected.push(clip.id);
                           }
                        });

                        setSelectedClipIds(newSelected);
                      }
                    };

                    const handlePointerUp = (upEvent: PointerEvent) => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                      
                      if (isMarquee) {
                        setMarquee(null);
                      } else if (!hasMoved && copiedClip) {
                        // Handle paste popup exactly as before if no drag occurred
                        const trackElement = target.closest(".track-space");
                        const layerId = trackElement?.getAttribute("data-layer-id") || undefined;
                        setPastePopup({
                          x: startX,
                          y: startY,
                          time: clickTime,
                          layerId,
                        });
                      }

                      container.releasePointerCapture(upEvent.pointerId);
                      window.removeEventListener("pointermove", handlePointerMove);
                      window.removeEventListener("pointerup", handlePointerUp);
                      window.removeEventListener("pointercancel", handlePointerUp);
                    };

                    window.addEventListener("pointermove", handlePointerMove, { passive: false });
                    window.addEventListener("pointerup", handlePointerUp);
                    window.addEventListener("pointercancel", handlePointerUp);

                    // Start Long Press Timer for Marquee
                    longPressTimerRef.current = setTimeout(() => {
                      if (!hasMoved) {
                        isMarquee = true;
                        const absStartX = startX - rect.left + masterScroll.scrollLeft;
                        const absStartY = startY - rect.top + masterScroll.scrollTop;
                        setMarquee({ startX: absStartX, startY: absStartY, currentX: absStartX, currentY: absStartY });
                      }
                    }, 350);
                  }
                }}
                onPointerMove={() => {
                  pointerMoveCanvasRef.current = true;
                }}
                onPointerUp={() => {
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                }}
                onPointerLeave={() => {
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                }}
              >
                {/* Scroll Content Width defined by max duration */}
                <div
                  id="timeline-content"
                  className="min-h-full min-w-full flex flex-col"
                  style={{
                    paddingRight: "calc(100vw - 100px)",
                    paddingBottom: "0px",
                    width: "fit-content",
                    boxSizing: "content-box",
                  }}
                >
                  <div
                    id="timeline-inner"
                    className="relative min-h-full w-full"
                    style={{
                      width: `${maxTimelineDuration * pixelsPerSecond}px`,
                    }}
                  >
                    {/* Moving Playhead Cursor Removed (Now stationary in parent) */}

                    {/* Tracks Grid Area */}
                    <div
                      className="w-full pb-[200px] relative z-10"
                      style={{ paddingTop: "0" }}
                    >
                      {visibleLayers.map((layer) => (
                        <div
                          key={layer.id}
                          data-layer-id={layer.id}
                          className={`relative h-[52px] sm:h-[60px] w-full border-b flex items-center group track-space transition-all transform-gpu ${draggingLayerId === layer.id ? "bg-indigo-500/10 border-indigo-500/30 scale-[1.02] shadow-xl z-50 rounded-lg overflow-hidden" : "border-white/5 z-0"}`}
                        >
                          {/* Grid Background */}
                          <div
                            className="absolute inset-0 pointer-events-none opacity-20"
                            style={{
                              backgroundImage:
                                zoomLevel > 1
                                  ? `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px)`
                                  : `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)`,
                              backgroundSize:
                                zoomLevel > 1
                                  ? `${pixelsPerSecond}px 100%, ${pixelsPerSecond / 10}px 100%`
                                  : `${pixelsPerSecond}px 100%`,
                              backgroundPosition: `0 0`,
                            }}
                          />

                          {/* Render Clips for this layer */}
                          {clips
                            .filter((c) => c.layerId === layer.id)
                            .map((clip) => (
                              <motion.div
                                key={clip.id}
                                onPointerDown={(e) =>
                                  handleClipDragStart(e, clip)
                                }
                                className={`absolute h-[40px] sm:h-[48px] rounded-lg overflow-hidden flex items-center cursor-pointer select-none transition-shadow
                                           ${clip.type === "video" ? "bg-[#3b82f6]" : clip.type === "audio" ? "bg-[#a855f7]" : clip.type === "text" ? "bg-[#f59e0b]" : "bg-[#10b981]"}
                                           ${selectedClipIds.includes(clip.id) ? "ring-2 ring-white/90 shadow-[0_0_15px_rgba(255,255,255,0.5)] z-20 opacity-100 scale-[1.01]" : "opacity-85 hover:opacity-100 z-10"}
                                           ${layer.isHidden || (layer.isMuted && clip.type === "audio") ? "grayscale opacity-30 shadow-none" : ""}
                                        `}
                                initial={false}
                                animate={{
                                  left: clip.leftSeconds * pixelsPerSecond,
                                  width: Math.max(2, clip.durationSeconds * pixelsPerSecond),
                                }}
                                transition={{ type: "spring", stiffness: 600, damping: 45, mass: 0.8 }}
                                style={{
                                  touchAction: "none",
                                }}
                              >
                                <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>
                                {clip.type === "text" && (
                                  <div className="w-full h-full flex items-center px-2 pointer-events-none overflow-hidden">
                                    <span className="text-[14px] font-bold text-white truncate drop-shadow-md">
                                      {clip.text}
                                    </span>
                                  </div>
                                )}
                                {clip.type === "image" && (
                                  <img
                                    src={clip.src}
                                    className="w-full h-full object-cover opacity-60 pointer-events-none"
                                    draggable={false}
                                    onError={() => handleClipError(clip.id)}
                                  />
                                )}
                                {clip.type === "video" && (
                                  <div className="w-full h-full border border-white/20 rounded shadow-inner pointer-events-none"></div>
                                )}
                                {clip.type === "audio" && (
                                  <div className="w-full h-2 bg-white/30 rounded-full mx-2 pointer-events-none"></div>
                                )}

                                {/* Type indicator icon */}
                                <div className="absolute top-1 max-w-full overflow-hidden whitespace-nowrap pl-2 pointer-events-none flex items-center gap-1">
                                  {erroredClips.has(clip.id) &&
                                    clip.type !== "text" && (
                                      <span className="text-[10px] font-bold text-red-100 uppercase drop-shadow-md pb-0.5 px-1 bg-red-500/80 rounded inline-flex items-center gap-1">
                                        <AlertCircle size={10} /> Missing File
                                      </span>
                                    )}
                                  <span className="text-[10px] font-bold text-white uppercase drop-shadow-md pb-0.5 px-1 bg-black/20 rounded inline-flex items-center">
                                    {clip.type} {layer.isHidden && "(Hidden)"}{" "}
                                    {layer.isMuted && "(Muted)"}
                                  </span>
                                  {clip.opticalFlow && (
                                    <span className="text-[10px] font-bold text-indigo-200 uppercase drop-shadow-md pb-0.5 px-1 bg-indigo-500/50 rounded inline-flex items-center gap-1">
                                      <Activity size={10} /> Smooth
                                    </span>
                                  )}
                                </div>

                                {/* Keyframe Markers */}
                                {clip.keyframes?.map((kf) => (
                                  <div
                                    key={kf.id}
                                    className="absolute bottom-1 w-2.5 h-2.5 bg-white/90 border border-black/50 rotate-45 transform-gpu shadow-sm z-10 pointer-events-none"
                                    style={{
                                      left: `${(kf.timeOffset / clip.durationSeconds) * 100}%`,
                                      transform: "translateX(-50%) rotate(45deg)",
                                    }}
                                  ></div>
                                ))}

                                {/* Trim Controls for selected */}
                                {selectedClipId === clip.id && (
                                  <>
                                    <div
                                      onPointerDown={(e) =>
                                        handleTrimStart(e, clip, "left")
                                      }
                                      className="absolute left-0 top-0 bottom-0 w-3 bg-white hover:w-4 flex items-center justify-center cursor-col-resize transition-all rounded-r"
                                      style={{ touchAction: "none" }}
                                    >
                                      <div className="w-0.5 h-3 bg-black/50 rounded-full"></div>
                                    </div>
                                    <div
                                      onPointerDown={(e) =>
                                        handleTrimStart(e, clip, "right")
                                      }
                                      className="absolute right-0 top-0 bottom-0 w-3 bg-white hover:w-4 flex items-center justify-center cursor-col-resize transition-all rounded-l"
                                      style={{ touchAction: "none" }}
                                    >
                                      <div className="w-0.5 h-3 bg-black/50 rounded-full"></div>
                                    </div>
                                  </>
                                )}
                              </motion.div>
                            ))}
                        </div>
                      ))}

                      {/* Empty state instruction inside timeline */}
                      {layers.length === 0 && (
                        <div className="w-full h-[150px] flex flex-col items-center justify-center pt-8 text-zinc-500 gap-3">
                          <PlusCircle size={32} className="opacity-30" />
                          <span className="text-sm font-medium tracking-wide">
                            Tap '+' to add media to your timeline
                          </span>
                        </div>
                      )}

                      {/* Marquee Selection Box */}
                      {marquee && (
                        <div
                          className="absolute bg-white/20 border border-white/50 z-[100] pointer-events-none rounded-[2px]"
                          style={{
                            left: Math.min(marquee.startX, marquee.currentX),
                            top: Math.min(marquee.startY, marquee.currentY),
                            width: Math.abs(marquee.currentX - marquee.startX),
                            height: Math.abs(marquee.currentY - marquee.startY)
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col font-sans">
      {/* Dynamic Render based on Screen */}
      {currentScreen === "home" && renderHome()}
      {currentScreen === "settings" && renderSettings()}
      {currentScreen === "editor" && renderEditor()}
      {currentScreen === "editor" && (
        <>
          {/* Floating Action Menu attached to bottom or overlay */}
          <motion.div
            layoutId="new-project-btn"
            layout
            transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
            className={`fixed bottom-10 left-1/2 -translate-x-1/2 flex flex-col bg-[#252528] overflow-hidden ${activeExpandedMenu === "speed-curves" ? "rounded-[24px] pt-1.5 pb-1 w-[320px]" : activeExpandedMenu ? "rounded-[24px] pt-1.5 pb-1 w-[253px]" : "rounded-[24px] h-[55px] justify-center w-[253px]"} shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/5 z-[200] transform-gpu`}
          >
            <AnimatePresence mode="popLayout">
              {activeExpandedMenu === "volume" && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full px-4 pb-1"
                >
                  <div className="flex justify-between items-center w-full mb-1 px-1 mt-1">
                    <button
                      className="flex items-center gap-3 text-[13px] text-zinc-300 hover:text-white"
                      onClick={() => setApplyVolumeToAll(!applyVolumeToAll)}
                    >
                      <div
                        className={`w-[18px] h-[18px] rounded-full border-[1.5px] ${applyVolumeToAll ? "border-white bg-white" : "border-zinc-500"} flex items-center justify-center transition-colors`}
                      >
                        {applyVolumeToAll && (
                          <div className="w-2 h-2 bg-black rounded-full" />
                        )}
                      </div>
                      Apply to all
                    </button>
                    <button
                      onClick={() => setActiveExpandedMenu(null)}
                      className="text-zinc-400 hover:text-white pb-0.5 pr-1"
                    >
                      <Check size={20} strokeWidth={2} />
                    </button>
                  </div>
                  
                  <div className="flex items-center w-full gap-4 px-1 mb-2 mt-1">
                    <div
                      className="flex-1 h-[16px] bg-[#e6e8ea] rounded-full relative cursor-ew-resize touch-none"
                      style={{
                        boxShadow: "inset 0px 2px 4px rgba(0,0,0,0.2), inset 0px -1px 2px rgba(255,255,255,1), 0 0 0 2px rgba(255,255,255,0.05)",
                        padding: "5px"
                      }}
                      onPointerDown={(e) => {
                        const target = e.currentTarget;
                        target.setPointerCapture(e.pointerId);
                        const updateVol = (clientX: number) => {
                          const rect = target.getBoundingClientRect();
                          let x = clientX - rect.left;
                          x = Math.max(0, Math.min(rect.width, x));
                          let val = Math.round((x / rect.width) * 100);
                          setClipVolume(val);
                          setClips((prev) =>
                            prev.map((c) => {
                              if (applyVolumeToAll && (c.type === "video" || c.type === "audio")) {
                                return { ...c, volume: val / 100 };
                              }
                              if (c.id === selectedClipId) {
                                return { ...c, volume: val / 100 };
                              }
                              return c;
                            })
                          );
                        };
                        updateVol(e.clientX);
                        const moveHandler = (me: PointerEvent) => updateVol(me.clientX);
                        const upHandler = (ue: PointerEvent) => {
                          target.releasePointerCapture(ue.pointerId);
                          target.removeEventListener("pointermove", moveHandler);
                          target.removeEventListener("pointerup", upHandler);
                          target.removeEventListener("pointercancel", upHandler);
                        };
                        target.addEventListener("pointermove", moveHandler);
                        target.addEventListener("pointerup", upHandler);
                        target.addEventListener("pointercancel", upHandler);
                      }}
                    >
                      <div
                        className="h-full rounded-full pointer-events-none transition-all duration-75 relative"
                        style={{
                          width: `${clipVolume}%`,
                          minWidth: clipVolume > 0 ? "18px" : "0px",
                          background: "linear-gradient(to bottom, #50555a, #2b2e32)",
                          boxShadow: "0px 1px 2px rgba(0,0,0,0.4), inset 0px 1px 1px rgba(255,255,255,0.2)",
                          opacity: clipVolume === 0 ? 0 : 1,
                        }}
                      />
                    </div>
                    <span className="text-[12px] text-zinc-300 font-sans w-8 text-right font-medium">
                      {clipVolume}%
                    </span>
                  </div>
                </motion.div>
              )}

              {activeExpandedMenu === "speed" && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full px-4 pb-1"
                >
                  <SpeedRulerControl
                    value={clipSpeed}
                    onChange={(val) => {
                      setClipSpeed(val);
                      if (selectedClipId) {
                        setClips((prev) =>
                          prev.map((c) =>
                            c.id === selectedClipId ? { ...c, speed: val } : c,
                          ),
                        );
                      }
                    }}
                    onReset={() => {
                      setClipSpeed(1);
                      if (selectedClipId) {
                        setClips((prev) =>
                          prev.map((c) =>
                            c.id === selectedClipId ? { ...c, speed: 1 } : c,
                          ),
                        );
                      }
                    }}
                    onClose={() => setActiveExpandedMenu(null)}
                  />
                  <div className="flex gap-2 pb-4">
                    <button
                      onClick={() => {
                        const currentClip = clips.find(
                          (c) => c.id === selectedClipId,
                        );
                        const isOpticalFlowApplied =
                          currentClip?.opticalFlow || false;

                        if (isOpticalFlowApplied) {
                          // Toggle off
                          if (selectedClipId) {
                            setClips((prev) =>
                              prev.map((c) =>
                                c.id === selectedClipId
                                  ? { ...c, opticalFlow: false }
                                  : c,
                              ),
                            );
                          }
                          return;
                        }

                        if (smoothProcessingProgress !== null) return;
                        setSmoothProcessingProgress(0);
                        let progress = 0;
                        const interval = setInterval(() => {
                          progress += Math.random() * 8 + 2;
                          if (progress >= 100) {
                            clearInterval(interval);
                            setSmoothProcessingProgress(100);

                            if (selectedClipId) {
                              setClips((prev) =>
                                prev.map((c) =>
                                  c.id === selectedClipId
                                    ? { ...c, opticalFlow: true }
                                    : c,
                                ),
                              );
                            }

                            setTimeout(() => {
                              setSmoothProcessingProgress(null);
                              showToast("Optical Flow Applied");
                            }, 500);
                          } else {
                            setSmoothProcessingProgress(
                              Math.min(99, Math.round(progress)),
                            );
                          }
                        }, 150);
                      }}
                      className={`flex-1 flex justify-center items-center gap-2 px-3 py-1.5 rounded-full transition-colors active:scale-95 relative overflow-hidden ${clips.find((c) => c.id === selectedClipId)?.opticalFlow ? "bg-indigo-600 hover:bg-indigo-500" : "bg-zinc-800 hover:bg-zinc-700"}`}
                    >
                      {smoothProcessingProgress !== null ? (
                        <>
                          <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
                            <svg
                              className="w-full h-full -rotate-90"
                              viewBox="0 0 16 16"
                            >
                              <circle
                                cx="8"
                                cy="8"
                                r="6"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                                className="text-zinc-600"
                              />
                              <circle
                                cx="8"
                                cy="8"
                                r="6"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                                className="text-white transition-all duration-150 ease-linear"
                                strokeDasharray="37.7"
                                strokeDashoffset={
                                  37.7 - (smoothProcessingProgress / 100) * 37.7
                                }
                              />
                            </svg>
                          </div>
                          <span className="text-[11px] font-mono text-white whitespace-nowrap">
                            {Math.round(smoothProcessingProgress)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] font-semibold text-white truncate">
                          Smooth
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveExpandedMenu("speed-curves")}
                      className="flex-1 flex justify-center items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors active:scale-95"
                    >
                      <span className="text-[11px] font-semibold text-white">
                        Curves
                      </span>
                    </button>
                  </div>
                </motion.div>
              )}
              {activeExpandedMenu === "speed-curves" && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full h-auto px-1 pt-0 pb-1"
                >
                  <SpeedCurveEditor onClose={() => setActiveExpandedMenu("speed")} />
                </motion.div>
              )}
              {activeExpandedMenu === "text" && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full h-auto px-2 pt-1 pb-1 gap-1 shrink-0 items-center overflow-hidden"
                >
                  <input
                    type="text"
                    value={clips.find((c) => c.id === selectedClipId)?.text || ""}
                    onChange={(e) => {
                      if (selectedClipId) {
                        setClips((prev) =>
                          prev.map((c) =>
                            c.id === selectedClipId
                              ? { ...c, text: e.target.value }
                              : c,
                          ),
                        );
                      }
                    }}
                    placeholder="Enter short text..."
                    className="w-full bg-transparent border-none text-center text-sm text-white focus:outline-none focus:ring-0 placeholder:text-zinc-600 mb-1"
                  />
                  <div className="flex items-center justify-between bg-black rounded-[24px] px-2 py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] border border-white/5 w-[237px] overflow-hidden">
                    <div className="flex items-center gap-1 pl-1 shrink-0">
                      {/* Color Picker (A_) */}
                      <div className="relative group flex items-center justify-center p-1 rounded-full hover:bg-zinc-800 cursor-pointer overflow-hidden transition-colors">
                        <div className="flex flex-col items-center pointer-events-none w-5 h-5 justify-center">
                          <span className="font-serif font-medium text-[13px] leading-none text-zinc-300 group-hover:text-white">A</span>
                          <div className="w-2.5 h-[2px] mt-[1px]" style={{ backgroundColor: clips.find((c) => c.id === selectedClipId)?.color || "#ffffff" }}></div>
                        </div>
                        <input
                          type="color"
                          value={clips.find((c) => c.id === selectedClipId)?.color || "#ffffff"}
                          onChange={(e) => {
                            if (selectedClipId) {
                               setClips(prev => prev.map(c => c.id === selectedClipId ? {...c, color: e.target.value} : c));
                            }
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </div>
                      
                      {/* Font Family (Aa) */}
                      <button 
                        className="p-1 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors w-7 h-7 shrink-0"
                        onClick={() => {
                          const fonts = ["sans-serif", "serif", "monospace", "Impact"];
                          const clip = clips.find(c => c.id === selectedClipId);
                          if (!clip) return;
                          const currentFont = clip.fontFamily || "sans-serif";
                          const nextFont = fonts[(fonts.indexOf(currentFont) + 1) % fonts.length];
                          setClips(prev => prev.map(c => c.id === selectedClipId ? {...c, fontFamily: nextFont} : c));
                        }}
                      >
                        <span className="font-serif font-medium text-[13px] leading-none">Aa</span>
                      </button>

                      {/* Font Size (TT) */}
                      <div className="relative group">
                         <button 
                           className="p-1 flex items-baseline justify-center rounded-full hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors w-7 h-7 shrink-0"
                           onClick={() => {
                             const clip = clips.find(c => c.id === selectedClipId);
                             if (!clip) return;
                             const currentSize = clip.fontSize || 48;
                             const nextSize = currentSize >= 100 ? 24 : currentSize + 16;
                             setClips(prev => prev.map(c => c.id === selectedClipId ? {...c, fontSize: nextSize} : c));
                           }}
                         >
                           <span className="font-serif font-medium text-[12px] leading-none">T</span>
                           <span className="font-serif font-medium text-[9px] leading-none">T</span>
                         </button>
                      </div>
                    </div>
                    
                    <div className="w-[1px] h-4 bg-zinc-800 shrink-0 mx-0.5"></div>
                    
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                         <Smile size={14} strokeWidth={1.5} />
                      </button>
                      <button className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                         <ImageIcon size={14} strokeWidth={1.5} />
                      </button>
                      <button className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                         <ListOrdered size={14} strokeWidth={1.5} />
                      </button>
                      <button className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                         <List size={14} strokeWidth={1.5} />
                      </button>
                    </div>

                    <div className="w-[1px] h-4 bg-zinc-800 shrink-0 mx-0.5"></div>

                    <div className="flex items-center gap-1 pl-1 shrink-0">
                      <button className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                         <Wand2 size={14} strokeWidth={1.5} />
                      </button>
                      <button 
                        onClick={() => setActiveExpandedMenu(null)}
                        className="p-1 w-6 h-6 shrink-0 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors flex items-center justify-center outline-none ml-0.5"
                      >
                         <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
              {activeExpandedMenu === "move" && selectedClipId && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full h-auto max-h-[300px] shrink-0 overflow-y-auto scrollbar-hide pt-0 pb-1"
                >
                  <div className="flex justify-between items-center w-full px-4 mb-2 shrink-0">
                    <span className="text-[11px] font-semibold text-white/90">
                      Transform
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? {
                                    ...c,
                                    translateX: 0,
                                    translateY: 0,
                                    rotation: 0,
                                    scale: 1,
                                  }
                                : c,
                            ),
                          );
                        }}
                        className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-300 hover:text-white uppercase tracking-wider transition-colors"
                      >
                        Reset All
                      </button>
                      <button
                        onClick={() => setActiveExpandedMenu(null)}
                        className="text-zinc-400 hover:text-white ml-1"
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full px-4 mt-2">
                    <div className="flex flex-col gap-2">
                      <CompactRulerControl
                        label="Rotation"
                        value={
                          clips.find((c) => c.id === selectedClipId)
                            ?.rotation || 0
                        }
                        onChange={(val) => {
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, rotation: val }
                                : c,
                            ),
                          );
                        }}
                        onReset={() =>
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, rotation: 0 }
                                : c,
                            ),
                          )
                        }
                        min={-180}
                        max={180}
                        step={1}
                        unit="°"
                        sensitivity={0.5}
                      />
                      <CompactRulerControl
                        label="Scale"
                        value={
                          clips.find((c) => c.id === selectedClipId)?.scale ?? 1
                        }
                        onChange={(val) => {
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, scale: val }
                                : c,
                            ),
                          );
                        }}
                        onReset={() =>
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId ? { ...c, scale: 1 } : c,
                            ),
                          )
                        }
                        min={0.1}
                        max={5}
                        step={0.01}
                        unit="x"
                        sensitivity={0.01}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <CompactRulerControl
                        label="Pos X"
                        value={
                          clips.find((c) => c.id === selectedClipId)
                            ?.translateX || 0
                        }
                        onChange={(val) => {
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, translateX: val }
                                : c,
                            ),
                          );
                        }}
                        onReset={() =>
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, translateX: 0 }
                                : c,
                            ),
                          )
                        }
                        min={-2000}
                        max={2000}
                        step={1}
                        unit="px"
                        sensitivity={1}
                      />
                      <CompactRulerControl
                        label="Pos Y"
                        value={
                          clips.find((c) => c.id === selectedClipId)
                            ?.translateY || 0
                        }
                        onChange={(val) => {
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, translateY: val }
                                : c,
                            ),
                          );
                        }}
                        onReset={() =>
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId
                                ? { ...c, translateY: 0 }
                                : c,
                            ),
                          )
                        }
                        min={-2000}
                        max={2000}
                        step={1}
                        unit="px"
                        sensitivity={1}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
              {activeExpandedMenu === "blend" && selectedClipId && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full h-auto pb-1 pt-0 shrink-0"
                >
                  <div className="flex justify-between items-center w-full px-4 mb-2">
                    <span className="text-[11px] font-semibold text-white/90">
                      Blend & Opacity
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setActiveExpandedMenu(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Blending Modes */}
                  <div className="flex items-center gap-2 px-3 overflow-x-auto scrollbar-hide snap-x pt-1 pb-2">
                    {["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"].map((mode) => {
                      const currentMode = clips.find((c) => c.id === selectedClipId)?.mixBlendMode || "normal";
                      const isActive = currentMode === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            setClips((prev) =>
                              prev.map((c) =>
                                c.id === selectedClipId ? { ...c, mixBlendMode: mode as any } : c
                              )
                            );
                          }}
                          className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium capitalize transition-colors snap-start border ${isActive ? "bg-white text-black border-white" : "bg-zinc-800 text-zinc-300 border-white/5 hover:bg-zinc-700"}`}
                        >
                          {mode.replace("-", " ")}
                        </button>
                      );
                    })}
                  </div>

                  {/* Opacity Control */}
                  <div className="px-4 mt-1">
                     <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase pl-1">Opacity</span>
                        <span className="text-[10px] text-zinc-400 font-mono pr-1">
                          {Math.round((clips.find((c) => c.id === selectedClipId)?.opacity ?? 1) * 100)}%
                        </span>
                     </div>
                     <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={clips.find((c) => c.id === selectedClipId)?.opacity ?? 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClipId ? { ...c, opacity: val } : c
                            )
                          );
                        }}
                        className="w-full accent-white h-1 bg-zinc-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer mt-1"
                     />
                  </div>
                </motion.div>
              )}
              {activeExpandedMenu === "crop" && selectedClipId && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="bg-zinc-800 rounded-2xl shadow-xl border border-white/10 overflow-hidden"
                >
                  <div className="flex items-center gap-2 p-2 w-[220px]">
                    {["None", "1:1", "16:9", "9:16", "4:3"].map((ratio) => {
                      const currentRatio =
                        clips.find((c) => c.id === selectedClipId)?.cropRatio || "None";
                      return (
                        <button
                          key={ratio}
                          onClick={() => {
                            if (selectedClipId) {
                               setClips(prev => prev.map(c => c.id === selectedClipId ? {...c, cropRatio: ratio === "None" ? null : ratio as any} : c));
                            }
                          }}
                          className={`flex-1 flex justify-center items-center px-1.5 py-1.5 rounded-xl transition-colors text-xs font-medium ${currentRatio === ratio || (currentRatio === null && ratio === "None") ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"}`}
                        >
                          {ratio}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
              {activeExpandedMenu === "mask" && selectedClipId && (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col w-full h-auto pb-1 pt-0 shrink-0"
                >
                  <div className="flex justify-between items-center w-full px-4 mb-2">
                    <span className="text-[11px] font-semibold text-white/90">
                      Mask Shape
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setActiveExpandedMenu(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 px-3">
                    {[
                      {
                        id: "none",
                        name: "None",
                        icon: (
                          <div className="w-6 h-6 border-2 border-white/40" />
                        ),
                      },
                      {
                        id: "circle",
                        name: "Circle",
                        icon: (
                          <div className="w-6 h-6 border-2 border-white/40 rounded-full" />
                        ),
                      },
                      {
                        id: "square",
                        name: "Square",
                        icon: (
                          <div className="w-5 h-5 border-2 border-white/40" />
                        ),
                      },
                      {
                        id: "rounded",
                        name: "Rounded",
                        icon: (
                          <div className="w-6 h-6 border-2 border-white/40 rounded-md" />
                        ),
                      },
                    ].map((mask) => {
                      const isActive =
                        (clips.find((c) => c.id === selectedClipId)?.maskType ||
                          "none") === mask.id;
                      return (
                        <button
                          key={mask.id}
                          onClick={() => {
                            setClips((prev) =>
                              prev.map((c) =>
                                c.id === selectedClipId
                                  ? { ...c, maskType: mask.id as any }
                                  : c,
                              ),
                            );
                          }}
                          className={`flex flex-col items-center justify-center gap-2 p-2 rounded-xl transition-colors border ${isActive ? "bg-zinc-700 border-white/20" : "bg-zinc-800 border-transparent hover:border-white/10"}`}
                        >
                          <div className="h-8 flex items-center justify-center">
                            {mask.icon}
                          </div>
                          <span className="text-[9px] font-medium text-zinc-300">
                            {mask.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              layout
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="flex items-center gap-1 w-full px-2 justify-center"
            >
              <motion.button
                layout
                className="p-1.5 shrink-0 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon size={16} />
              </motion.button>
              <motion.div
                layout
                className="w-px h-6 bg-zinc-700 mx-1 shrink-0"
              ></motion.div>
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide w-[186px] overflow-hidden shrink-0 snap-x snap-mandatory">
                {flowBarOrder.map((key) => {
                  switch(key) {
                    case 'volume': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? (activeExpandedMenu === "volume" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "volume" ? null : "volume")}><Volume2 size={16} /></motion.button>
                    );
                    case 'text': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId && clips.find((c) => c.id === selectedClipId)?.type === "text" ? (activeExpandedMenu === "text" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "hover:bg-zinc-700 text-white"}`} onClick={() => { const sel = clips.find((c) => c.id === selectedClipId); if (sel && sel.type === "text") { setActiveExpandedMenu(activeExpandedMenu === "text" ? null : "text"); } else { handleAddText(); } }}><Type size={16} /></motion.button>
                    );
                    case 'crop': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId && ["video", "image"].includes(clips.find((c) => c.id === selectedClipId)?.type || "") ? (activeExpandedMenu === "crop" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId || !["video", "image"].includes(clips.find((c) => c.id === selectedClipId)?.type || "")} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "crop" ? null : "crop")}><Crop size={16} /></motion.button>
                    );
                    case 'adjust': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? "hover:bg-zinc-700 text-white" : "opacity-30"}`} disabled={!selectedClipId}><SlidersHorizontal size={16} /></motion.button>
                    );
                    case 'speed': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? (activeExpandedMenu === "speed" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "speed" ? null : "speed")}><Clock size={16} /></motion.button>
                    );
                    case 'copy': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? "hover:bg-zinc-700 text-white" : "opacity-30"}`} disabled={!selectedClipId} onClick={handleCopy}><Copy size={16} /></motion.button>
                    );
                    case 'extract-audio': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId && clips.find(c => c.id === selectedClipId)?.type === "video" ? "hover:bg-zinc-700 text-white" : "opacity-30"}`} disabled={!selectedClipId || clips.find(c => c.id === selectedClipId)?.type !== "video"} onClick={handleExtractAudio}><Music size={16} /></motion.button>
                    );
                    case 'move': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? (activeExpandedMenu === "move" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "move" ? null : "move")}><Move size={16} /></motion.button>
                    );
                    case 'magic': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? "hover:bg-zinc-700 text-white" : "opacity-30"}`} disabled={!selectedClipId}><Wand2 size={16} /></motion.button>
                    );
                    case 'activity': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? (activeExpandedMenu === "blend" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "blend" ? null : "blend")}><Blend size={16} /></motion.button>
                    );
                    case 'mask': return (
                      <motion.button key={key} layout className={`p-1.5 shrink-0 rounded-full transition-colors snap-start flex items-center justify-center ${selectedClipId ? (activeExpandedMenu === "mask" ? "bg-zinc-700 text-white" : "hover:bg-zinc-700 text-white") : "opacity-30"}`} disabled={!selectedClipId} onClick={() => setActiveExpandedMenu(activeExpandedMenu === "mask" ? null : "mask")}><SquareDashed size={16} /></motion.button>
                    );
                    default: return null;
                  }
                })}
              </div>
            </motion.div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileUpload}
              accept="video/*,audio/*,image/*"
            />
          </motion.div>
          {/* Keyframe Curve Graph Overlay */}
          <AnimatePresence>
            {showKeyframeGraph && selectedClipId && isBetweenKeyframes && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-[110px] left-1/2 -translate-x-1/2 w-[340px] bg-[#252528] rounded-2xl p-4 shadow-[0_30px_60px_rgba(0,0,0,0.6)] border border-white/5 z-[250]"
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[11px] font-semibold text-white/90 uppercase tracking-widest text-indigo-400">Keyframe Interpolation</span>
                  <button onClick={() => setShowKeyframeGraph(false)} className="text-zinc-400 hover:text-white p-1 bg-white/5 rounded-full">
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2 mt-2">
                  {[
                    { id: "linear", name: "Linear", path: "M 2 10 L 22 2" },
                    { id: "easeIn", name: "Ease In", path: "M 2 10 Q 16 10 22 2" },
                    { id: "easeOut", name: "Ease Out", path: "M 2 10 Q 8 2 22 2" },
                    { id: "easeInOut", name: "In Out", path: "M 2 10 C 8 10 16 2 22 2" },
                    { id: "hold", name: "Hold", path: "M 2 10 L 12 10 L 12 2 L 22 2" },
                  ].map((preset) => {
                    return (
                    <button
                      key={preset.name}
                      onClick={() => {
                         const cId = selectedClipId;
                         setClips(prev => prev.map(c => {
                           if (c.id !== cId) return c;
                           const kfs = [...(c.keyframes || [])].sort((a,b) => a.timeOffset - b.timeOffset);
                           const timeInClip = currentTime - c.leftSeconds;
                           const idx = kfs.findIndex(k => k.timeOffset > timeInClip);
                           if (idx > 0) {
                             kfs[idx - 1] = { ...kfs[idx - 1], curve: preset.id as any };
                           }
                           return { ...c, keyframes: kfs };
                         }));
                      }}
                      className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors border border-transparent hover:border-white/10 active:scale-95 group"
                    >
                      <div className="h-4 w-full opacity-60 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                        <svg width="20" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d={preset.path} />
                        </svg>
                      </div>
                      <span className="text-[8px] font-medium text-zinc-300 group-hover:text-white transition-colors">{preset.name}</span>
                    </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Global Project Saving Toast */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-white text-black px-5 py-2.5 rounded-full shadow-2xl z-50 font-bold tracking-wide animate-fade-in-down border border-black/10">
          {toastMessage}
        </div>
      )}

      {/* Paste Popup */}
      <AnimatePresence>
        {pastePopup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-[100] bg-zinc-800 border border-white/10 rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ left: pastePopup.x, top: pastePopup.y }}
          >
            <button
              onClick={handlePaste}
              className="px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <Copy size={16} /> Paste Here
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MinusIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}

function CompactRulerControl({
  value,
  onChange,
  onReset,
  min,
  max,
  step = 1,
  unit = "",
  label,
  sensitivity = 1,
}: {
  value: number;
  onChange: (val: number) => void;
  onReset: () => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  label: string;
  sensitivity?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startVal = useRef(value);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startVal.current = value;
    document.body.style.cursor = "ew-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startX.current;

    let newVal = startVal.current + deltaX * sensitivity;

    if (step) {
      newVal = Math.round(newVal / step) * step;
    }

    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    document.body.style.cursor = "";
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="flex flex-col gap-1 w-full pb-1 select-none">
      <div className="flex justify-between items-center px-1">
        <span className="text-[9px] text-zinc-500 font-bold tracking-wider uppercase">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-300 font-mono w-8 text-right">
            {Number(value.toFixed(2))}
            {unit}
          </span>
          <button
            className="text-[9px] w-4 h-4 flex items-center justify-center bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
            onClick={onReset}
          >
            R
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="h-6 mx-0 rounded bg-zinc-900/50 relative overflow-hidden cursor-ew-resize border border-white/5 active:border-white/10 transition-colors"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute inset-y-0 left-0 right-0 pointer-events-none opacity-40 text-xs text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px)",
            backgroundSize: "10px 6px",
            backgroundPosition: `calc(50% + ${-value / sensitivity}px) bottom`,
            backgroundRepeat: "repeat-x",
          }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-white rounded-full pointer-events-none shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
      </div>
    </div>
  );
}

const SPEED_VALUES = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5,
  1.6, 1.7, 1.8, 1.9, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0, 50.0,
];

function valToPos(val: number) {
  for (let i = 0; i < SPEED_VALUES.length - 1; i++) {
    if (val >= SPEED_VALUES[i] && val <= SPEED_VALUES[i + 1]) {
      const ratio =
        (val - SPEED_VALUES[i]) / (SPEED_VALUES[i + 1] - SPEED_VALUES[i]);
      return i + ratio;
    }
  }
  if (val <= SPEED_VALUES[0]) return 0;
  return SPEED_VALUES.length - 1;
}

function posToVal(pos: number) {
  if (pos <= 0) return SPEED_VALUES[0];
  if (pos >= SPEED_VALUES.length - 1)
    return SPEED_VALUES[SPEED_VALUES.length - 1];
  const i = Math.floor(pos);
  const ratio = pos - i;
  return SPEED_VALUES[i] + ratio * (SPEED_VALUES[i + 1] - SPEED_VALUES[i]);
}

function SpeedRulerControl({
  value,
  onChange,
  onReset,
  onClose,
}: {
  value: number;
  onChange: (val: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startPos = useRef(0);

  const TICK_SPACING = 40;
  const VIRTUAL_POS = valToPos(value);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startPos.current = valToPos(value);
    document.body.style.cursor = "ew-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startX.current;

    let newPos = startPos.current - deltaX / TICK_SPACING;
    let newVal = posToVal(newPos);

    const nearestIndex = Math.round(newPos);
    if (Math.abs(newPos - nearestIndex) < 0.1) {
      newVal =
        SPEED_VALUES[
          Math.max(0, Math.min(SPEED_VALUES.length - 1, nearestIndex))
        ];
    } else {
      newVal = Number(newVal.toFixed(2));
    }

    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    document.body.style.cursor = "";
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="flex flex-col w-full select-none mt-1 pb-3">
      <div className="flex justify-between items-center mb-3 pl-1 pr-1">
        <span className="text-[12px] font-semibold text-white/90">Speed</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-white font-mono w-12 text-right mr-2">
            {value}x
          </span>
          <button
            className="text-[10px] w-5 h-5 flex items-center justify-center bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
            onClick={onReset}
          >
            R
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1"></div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white ml-1"
          >
            <Check size={16} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="h-[52px] mx-0 relative overflow-hidden cursor-ew-resize touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute top-0 bottom-0 left-1/2"
          style={{ transform: `translateX(${-VIRTUAL_POS * TICK_SPACING}px)` }}
        >
          {SPEED_VALUES.map((speed, i) => {
            const isMajor =
              speed === 1.0 ||
              speed === 2.0 ||
              speed === 5.0 ||
              speed === 10.0 ||
              speed === 20.0 ||
              speed === 50.0 ||
              speed === 0.1 ||
              speed === 0.5;
            const isCurrent = Math.round(VIRTUAL_POS) === i;

            return (
              <div
                key={i}
                className="absolute flex flex-col items-center justify-center pointer-events-none h-full"
                style={{
                  left: `${i * TICK_SPACING}px`,
                  transform: "translateX(-50%)",
                }}
              >
                <div
                  className={`w-[3px] rounded-full transition-all duration-150 ${isCurrent ? "h-6 bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]" : isMajor ? "h-5 bg-white/60" : "h-3 bg-white/20"}`}
                />
                {isMajor && (
                  <span
                    className={`absolute bottom-0 text-[10px] translate-y-[12px] ${isCurrent ? "text-yellow-400 font-bold" : "text-zinc-500"}`}
                  >
                    {speed}x
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[12px] w-[3px] h-8 bg-white rounded-full pointer-events-none shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
      </div>
    </div>
  );
}

function VideoRenderer({
  id,
  clip,
  currentTime,
  isPlaying,
  isMuted,
  style,
  className,
  onPointerDown,
  onError,
}: {
  id?: string;
  clip: Clip;
  currentTime: number;
  isPlaying: boolean;
  isMuted: boolean;
  style?: React.CSSProperties;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = typeof clip.volume === "number" ? clip.volume / 100 : 1;
    video.playbackRate = clip.speed || 1;

    const targetTime =
      (currentTime - clip.leftSeconds) * (clip.speed || 1) +
      clip.trimStartSeconds;

    if (!isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = targetTime;
      }
      if (!video.paused) video.pause();
    } else {
      if (Math.abs(video.currentTime - targetTime) > 0.5) {
        video.currentTime = targetTime;
      }
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch((e) => {
            if (e.name !== "AbortError") console.error("Video play failed", e);
          });
        }
      }
    }
  }, [
    currentTime,
    isPlaying,
    clip.leftSeconds,
    clip.trimStartSeconds,
    clip.volume,
    clip.speed,
  ]);

  return (
    <video
      id={id}
      ref={videoRef}
      src={clip.src}
      className={className || "w-full h-full object-cover"}
      muted={isMuted}
      playsInline
      style={style}
      crossOrigin="anonymous"
      onPointerDown={onPointerDown}
      onError={onError}
    />
  );
}

function AudioRenderer({
  clip,
  currentTime,
  isPlaying,
  isMuted,
  onError,
}: {
  clip: Clip;
  currentTime: number;
  isPlaying: boolean;
  isMuted: boolean;
  onError?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = typeof clip.volume === "number" ? clip.volume / 100 : 1;
    audio.playbackRate = clip.speed || 1;

    const targetTime =
      (currentTime - clip.leftSeconds) * (clip.speed || 1) +
      clip.trimStartSeconds;

    if (!isPlaying) {
      if (Math.abs(audio.currentTime - targetTime) > 0.1) {
        audio.currentTime = targetTime;
      }
      if (!audio.paused) audio.pause();
    } else {
      if (Math.abs(audio.currentTime - targetTime) > 0.5) {
        audio.currentTime = targetTime;
      }
      if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((e) => {
            if (e.name !== "AbortError") console.error("Audio play failed", e);
          });
        }
      }
    }
  }, [
    currentTime,
    isPlaying,
    clip.leftSeconds,
    clip.trimStartSeconds,
    clip.volume,
    clip.speed,
  ]);

  return (
    <audio ref={audioRef} src={clip.src} muted={isMuted} onError={onError} />
  );
}
