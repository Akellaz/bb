import { useState, useEffect, useRef, useCallback } from 'react';

// =========================================================
// КОНСТАНТЫ И МАППИНГ
// =========================================================
const CHECKPOINT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/drums_2bar_hikl_small';
const GRID_SIZE = 11;

// Готовые паттерны
const PRESETS: Record<string, number[]> = {
  "Rock 1": [1, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0],
  "Rock 2": [385, 0, 1, 0, 256, 0, 1, 1, 386, 0, 0, 1, 256, 0, 1, 0, 385, 0, 1, 0, 256, 1, 0, 0, 386, 0, 1, 0, 258, 1, 1, 258],
  "Reggaeton": [257, 0, 0, 258, 1, 0, 258, 0, 1, 256, 256, 2, 1, 0, 258, 0, 257, 0, 0, 258, 1, 0, 258, 0, 257, 256, 0, 258, 1, 0, 258, 0],
  "Break": [5, 0, 5, 0, 6, 0, 4, 2, 5, 2, 5, 0, 6, 0, 4, 0, 5, 0, 5, 0, 6, 0, 4, 2, 5, 2, 5, 0, 6, 0, 4, 0],
  "Basic Backbeat": [5, 0, 4, 0, 7, 0, 4, 0, 5, 0, 4, 0, 7, 0, 4, 0, 5, 0, 4, 0, 7, 0, 4, 0, 5, 0, 4, 0, 7, 0, 4, 0],
  "Boots & Cats": [1, 0, 4, 0, 2, 0, 4, 0, 1, 0, 4, 0, 2, 0, 4, 0, 1, 0, 4, 0, 2, 0, 4, 0, 1, 0, 4, 0, 2, 0, 4, 0],
  "Pop Punk": [5, 4, 10, 5, 4, 5, 10, 4, 5, 4, 10, 5, 4, 5, 10, 4, 5, 4, 10, 5, 4, 5, 10, 4, 5, 5, 10, 5, 22, 26, 5, 6],
  "Half Time": [5, 0, 4, 0, 4, 0, 5, 0, 6, 0, 4, 0, 4, 0, 5, 0, 4, 0, 5, 0, 4, 0, 5, 0, 6, 0, 4, 1, 4, 0, 5, 0]
};

const PRESET_NAMES = Object.keys(PRESETS);

// MIDI → номер дорожки (0-8)
const MIDI_TO_ROW: Record<number, number> = {
  36:0, 35:0,
  38:1, 27:1, 28:1, 31:1, 32:1, 33:1, 34:1, 37:1, 39:1, 40:1, 56:1, 65:1, 66:1, 75:1, 85:1,
  42:2, 44:2, 54:2, 68:2, 69:2, 70:2, 71:2, 73:2, 78:2, 80:2,
  46:3, 67:3, 72:3, 74:3, 79:3, 81:3,
  45:4, 29:4, 41:4, 61:4, 64:4, 84:4,
  48:5, 47:5, 60:5, 63:5, 77:5, 86:5, 87:5,
  50:6, 30:6, 43:6, 62:6, 76:6, 83:6,
  49:7, 55:7, 57:7, 58:7,
  51:8, 52:8, 53:8, 59:8, 82:8
};

const ROW_TO_MIDI = [36, 38, 42, 46, 45, 48, 50, 49, 51];

const COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#34d399',
  '#8b5cf6', '#8b5cf6', '#8b5cf6', '#ec4899', '#ec4899'
];

// Размеры ячеек
const STEP_W = 2;
const STEP_H = 8;
const GAP = 4;

// =========================================================
// ТИПЫ
// =========================================================
type InterpolationMode = 'linear' | 'bilinear';

// =========================================================
// КОНВЕРТЕРЫ
// =========================================================
function maskToNoteSequence(mask: number[]) {
  const notes: any[] = [];
  mask.forEach((value, step) => {
    for (let row = 0; row < 9; row++) {
      if ((value >> row) & 1) {
        notes.push({
          pitch: ROW_TO_MIDI[row],
          quantizedStartStep: step,
          quantizedEndStep: step + 1
        });
      }
    }
  });
  return {
    notes,
    totalQuantizedSteps: 32,
    quantizationInfo: { stepsPerQuarter: 4 }
  };
}

function noteSequenceToMask(ns: any): number[] {
  const mask = new Array(32).fill(0);
  ns.notes.forEach((n: any) => {
    const row = MIDI_TO_ROW[n.pitch];
    if (row !== undefined) {
      mask[n.quantizedStartStep] += Math.pow(2, row);
    }
  });
  return mask;
}

// =========================================================
// ОТРИСОВКА
// =========================================================
function drawPattern(ctx: CanvasRenderingContext2D, pattern: number[], x: number, y: number, isCorner = false) {
  const cellW = 32 * STEP_W;
  const cellH = 9 * STEP_H;

  ctx.fillStyle = isCorner ? '#3a3a3a' : '#2a2a2a';
  ctx.fillRect(x, y, cellW, cellH);

  if (isCorner) {
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, cellW, cellH);
  }

  for (let step = 0; step < 32; step++) {
    const value = pattern[step];

    if (step % 4 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x + step * STEP_W, y, STEP_W, cellH);
    }

    for (let row = 0; row < 9; row++) {
      if ((value >> row) & 1) {
        ctx.fillStyle = COLORS[row];
        ctx.fillRect(x + step * STEP_W, y + row * STEP_H, STEP_W, STEP_H);
      }
    }
  }
}

function drawLinearGrid(canvas: HTMLCanvasElement, patterns: number[][], labels: [string, string]) {
  const ctx = canvas.getContext('2d')!;
  const cellW = 32 * STEP_W;
  const cellH = 9 * STEP_H;
  const cols = GRID_SIZE;
  const rows = 1;

  const totalW = cols * cellW + (cols - 1) * GAP;
  const totalH = rows * cellH + (rows - 1) * GAP + 40; // +40 for labels
  canvas.width = totalW;
  canvas.height = totalH;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, totalW, totalH);

  // Labels
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`← ${labels[0]}`, 0, 14);
  ctx.textAlign = 'right';
  ctx.fillText(`${labels[1]} →`, totalW, 14);

  // Draw patterns
  for (let i = 0; i < patterns.length; i++) {
    const x = i * (cellW + GAP);
    const y = 24;
    const isEndpoint = i === 0 || i === patterns.length - 1;
    drawPattern(ctx, patterns[i], x, y, isEndpoint);
  }

  // Progress bar
  const barY = 24 + cellH + 8;
  const barH = 4;
  ctx.fillStyle = '#333';
  ctx.fillRect(0, barY, totalW, barH);
  const gradient = ctx.createLinearGradient(0, 0, totalW, 0);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#ec4899');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, barY, totalW, barH);
}

function drawBilinearGrid(canvas: HTMLCanvasElement, patterns: number[][], cornerNames: string[]) {
  const ctx = canvas.getContext('2d')!;
  const cellW = 32 * STEP_W;
  const cellH = 9 * STEP_H;
  const grid = GRID_SIZE;

  const totalW = grid * cellW + (grid - 1) * GAP;
  const totalH = grid * cellH + (grid - 1) * GAP;
  canvas.width = totalW;
  canvas.height = totalH;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, totalW, totalH);

  for (let i = 0; i < patterns.length; i++) {
    const col = i % grid;
    const row = Math.floor(i / grid);
    const x = col * (cellW + GAP);
    const y = row * (cellH + GAP);

    const isCorner = (row === 0 && col === 0) ||
                     (row === 0 && col === grid - 1) ||
                     (row === grid - 1 && col === 0) ||
                     (row === grid - 1 && col === grid - 1);

    drawPattern(ctx, patterns[i], x, y, isCorner);
  }

  // Corner labels
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'left';

  const positions = [
    { x: 0, y: -4 },
    { x: (grid - 1) * (cellW + GAP), y: -4 },
    { x: 0, y: grid * (cellH + GAP) - GAP + 12 },
    { x: (grid - 1) * (cellW + GAP), y: grid * (cellH + GAP) - GAP + 12 }
  ];

  cornerNames.forEach((name, i) => {
    ctx.fillText(name, positions[i].x, positions[i].y);
  });
}

// =========================================================
// КОМПОНЕНТ
// =========================================================
export default function App() {
  const [mode, setMode] = useState<InterpolationMode>('bilinear');
  const [modelReady, setModelReady] = useState(false);
  const [status, setStatus] = useState('⏳ Загрузка модели MusicVAE (~5 МБ)...');
  const [statusType, setStatusType] = useState<'loading' | 'success' | 'error'>('loading');
  const [loading, setLoading] = useState(false);

  // Linear mode states
  const [linearFrom, setLinearFrom] = useState('Rock 1');
  const [linearTo, setLinearTo] = useState('Break');

  // Bilinear mode states
  const [corner0, setCorner0] = useState('Rock 1');
  const [corner1, setCorner1] = useState('Break');
  const [corner2, setCorner2] = useState('Reggaeton');
  const [corner3, setCorner3] = useState('Basic Backbeat');

  const mvaeRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize model
  useEffect(() => {
    const mvae = new (window as any).mm.MusicVAE(CHECKPOINT);
    mvaeRef.current = mvae;

    mvae.initialize().then(() => {
      setStatus('✅ Модель готова. Выберите режим интерполяции и паттерны.');
      setStatusType('success');
      setModelReady(true);
    }).catch((err: Error) => {
      setStatus('❌ Ошибка загрузки модели: ' + err.message);
      setStatusType('error');
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!mvaeRef.current) return;
    setLoading(true);

    try {
      if (mode === 'linear') {
        setStatus('⏳ Линейная интерполяция (30-60 сек)...');
        setStatusType('loading');

        const fromMask = PRESETS[linearFrom];
        const toMask = PRESETS[linearTo];
        const fromNS = maskToNoteSequence(fromMask);
        const toNS = maskToNoteSequence(toMask);

        const results = await mvaeRef.current.interpolate([fromNS, toNS], GRID_SIZE);
        const grid = results.map(noteSequenceToMask);

        // Override endpoints
        grid[0] = fromMask;
        grid[GRID_SIZE - 1] = toMask;

        if (canvasRef.current) {
          drawLinearGrid(canvasRef.current, grid, [linearFrom, linearTo]);
        }

        setStatus(`✅ Готово! Линейная интерполяция: ${GRID_SIZE} шагов от "${linearFrom}" к "${linearTo}".`);
        setStatusType('success');

      } else {
        setStatus('⏳ Билинейная интерполяция 11×11 (1-2 мин)...');
        setStatusType('loading');

        const TL = PRESETS[corner0];
        const TR = PRESETS[corner1];
        const BL = PRESETS[corner2];
        const BR = PRESETS[corner3];

        // Порядок: [TL, BL, TR, BR] — как в Beat Blender
        const corners = [TL, BL, TR, BR];
        const noteSeqs = corners.map(maskToNoteSequence);

        const results = await mvaeRef.current.interpolate(noteSeqs, GRID_SIZE);
        const grid = results.map(noteSequenceToMask);

        // Override corners
        grid[0] = TL;
        grid[10] = TR;
        grid[110] = BL;
        grid[120] = BR;

        if (canvasRef.current) {
          drawBilinearGrid(canvasRef.current, grid, [corner0, corner1, corner2, corner3]);
        }

        setStatus(`✅ Готово! Билинейная интерполяция: ${GRID_SIZE}×${GRID_SIZE} = ${GRID_SIZE * GRID_SIZE} ритмов.`);
        setStatusType('success');
      }
    } catch (err: any) {
      console.error(err);
      setStatus('❌ Ошибка: ' + err.message);
      setStatusType('error');
    } finally {
      setLoading(false);
    }
  }, [mode, linearFrom, linearTo, corner0, corner1, corner2, corner3]);

  const statusColors = {
    loading: 'text-yellow-300',
    success: 'text-emerald-400',
    error: 'text-red-400'
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-gray-100 font-sans p-5 max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-bold mb-4">🥁 Beat Blender — Интерполяция ритмов</h1>

      {/* Status */}
      <div className={`px-4 py-3 bg-[#2a2a2a] rounded-lg mb-4 font-medium ${statusColors[statusType]}`}>
        {status}
      </div>

      {/* Mode Selector */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 border-b border-gray-700 pb-2">Тип интерполяции</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setMode('linear')}
            className={`px-5 py-3 rounded-lg font-semibold text-sm transition-all ${
              mode === 'linear'
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#333] hover:text-gray-200'
            }`}
          >
            📏 Линейная (2 точки)
          </button>
          <button
            onClick={() => setMode('bilinear')}
            className={`px-5 py-3 rounded-lg font-semibold text-sm transition-all ${
              mode === 'bilinear'
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#333] hover:text-gray-200'
            }`}
          >
            🎛️ Билинейная (4 угла)
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {mode === 'linear'
            ? 'Интерполяция между двумя паттернами. Одна ось смешивания — плавный переход от начала к концу.'
            : 'Интерполяция между четырьмя углами. Двумерное пространство — смешивание по горизонтали и вертикали.'}
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 border-b border-gray-700 pb-2">Паттерны</h2>

        {mode === 'linear' ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Откуда (начало):</label>
              <select
                value={linearFrom}
                onChange={(e) => setLinearFrom(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Куда (конец):</label>
              <select
                value={linearTo}
                onChange={(e) => setLinearTo(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">↖ Верх-лево (TL):</label>
              <select
                value={corner0}
                onChange={(e) => setCorner0(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">↗ Верх-право (TR):</label>
              <select
                value={corner1}
                onChange={(e) => setCorner1(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">↙ Низ-лево (BL):</label>
              <select
                value={corner2}
                onChange={(e) => setCorner2(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">↘ Низ-право (BR):</label>
              <select
                value={corner3}
                onChange={(e) => setCorner3(e.target.value)}
                className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded text-sm text-gray-100"
              >
                {PRESET_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!modelReady || loading}
        className="px-6 py-3 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 disabled:bg-gray-700 disabled:cursor-not-allowed transition-all mb-6"
      >
        {loading
          ? '⏳ Генерация...'
          : mode === 'linear'
            ? `Сгенерировать линейную интерполяцию (${GRID_SIZE} шагов)`
            : `Сгенерировать билинейную интерполяцию ${GRID_SIZE}×${GRID_SIZE}`
        }
      </button>

      {/* Canvas */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 border-b border-gray-700 pb-2">
          {mode === 'linear'
            ? `Линейная интерполяция (${GRID_SIZE} шагов)`
            : `Билинейная интерполяция ${GRID_SIZE}×${GRID_SIZE} (${GRID_SIZE * GRID_SIZE} ритмов)`}
        </h2>
        <canvas
          ref={canvasRef}
          className="bg-[#2a2a2a] rounded-lg block mx-auto"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-red-500"></span>Kick
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-amber-500"></span>Snare
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-emerald-500"></span>Closed HH
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-emerald-400"></span>Open HH
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-violet-500"></span>Toms
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 inline-block rounded-sm bg-pink-500"></span>Crash / Ride
        </span>
      </div>

      {/* Info */}
      <div className="mt-8 text-xs text-gray-500 border-t border-gray-800 pt-4">
        <p><strong>Линейная интерполяция:</strong> Плавный переход между двумя ритмами через латентное пространство MusicVAE. Каждый шаг — промежуточный ритм.</p>
        <p className="mt-1"><strong>Билинейная интерполяция:</strong> Смешивание четырёх ритмов в двумерном пространстве. По горизонтали — переход TL→TR, по вертикали — BL→BR. Внутренние ячейки — комбинация обоих измерений.</p>
      </div>
    </div>
  );
}
