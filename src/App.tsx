import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from './utils/cn';

interface Vector2 {
  x: number;
  y: number;
}

interface Ray {
  origin: Vector2;
  direction: Vector2;
  color: string;
  intensity: number;
}

interface OpticObject {
  id: string;
  type: 'prism' | 'mirror' | 'light' | 'target';
  position: Vector2;
  rotation: number;
  size: number;
}

function add(v1: Vector2, v2: Vector2): Vector2 { return { x: v1.x + v2.x, y: v1.y + v2.y }; }
function sub(v1: Vector2, v2: Vector2): Vector2 { return { x: v1.x - v2.x, y: v1.y - v2.y }; }
function scale(s: number, v: Vector2): Vector2 { return { x: s * v.x, y: s * v.y }; }
function dot(v1: Vector2, v2: Vector2): number { return v1.x * v2.x + v1.y * v2.y; }
function normalize(v: Vector2): Vector2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}
function rotate(v: Vector2, angle: number): Vector2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
function reflect(incident: Vector2, normal: Vector2): Vector2 {
  const normalizedNormal = normalize(normal);
  const proj = scale(dot(incident, normalizedNormal), normalizedNormal);
  return sub(incident, scale(2, proj));
}

function refract(incident: Vector2, normal: Vector2, eta: number): Vector2 | null {
  const ni = normalize(incident);
  const nn = normalize(normal);
  let cosTheta = -dot(ni, nn);
  if (cosTheta < 0) return null;
  const sin2Theta = 1.0 - cosTheta * cosTheta;
  const sin2Phi = eta * eta * sin2Theta;
  if (sin2Phi > 1.0) return null;
  const cosPhi = Math.sqrt(1.0 - sin2Phi);
  return add(scale(eta, ni), scale(-eta * cosTheta + cosPhi, nn));
}

function getMirrorSegment(obj: OpticObject): {p1: Vector2, p2: Vector2, normal: Vector2} {
  const half = obj.size / 2;
  const localP1 = {x: -half, y: 0};
  const localP2 = {x: half, y: 0};
  const localNormal = {x: 0, y: 1}; // normal pointing 'up'
  const p1 = add(obj.position, rotate(localP1, obj.rotation));
  const p2 = add(obj.position, rotate(localP2, obj.rotation));
  const normal = rotate(localNormal, obj.rotation);
  return {p1, p2, normal};
}

function lineIntersect(origin: Vector2, dir: Vector2, p1: Vector2, p2: Vector2): {point: Vector2 | null, t: number, u: number} {
  const denom = (dir.x * (p2.y - p1.y)) - (dir.y * (p2.x - p1.x));
  if (Math.abs(denom) < 1e-6) return {point: null, t: -1, u: -1};
  const t = ((origin.x - p1.x) * (p2.y - p1.y) - (origin.y - p1.y) * (p2.x - p1.x)) / denom;
  const u = -((dir.x * (origin.y - p1.y)) - (dir.y * (origin.x - p1.x))) / denom;
  if (t >= 0 && u >= 0 && u <= 1) {
    return {point: add(origin, scale(t, dir)), t, u};
  }
  return {point: null, t: -1, u: -1};
}

function traceRay(initialOrigin: Vector2, initialDir: Vector2, colorIndex: number, objects: OpticObject[]): {segments: Array<{start: Vector2, end: Vector2, color: string}>} {
  const segments: Array<{start: Vector2, end: Vector2, color: string}> = [];
  let origin = { ...initialOrigin };
  let dir = normalize({ ...initialDir });
  const maxBounces = 10;
  const maxLength = 1000;
  let totalLength = 0;

  for (let bounce = 0; bounce < maxBounces; bounce++) {
    let minT = Infinity;
    let hitNormal: Vector2 | null = null;
    let hitPoint: Vector2 | null = null;
    let hitType: 'mirror' | 'prism' | null = null;

    // Mirrors
    const mirrors = objects.filter(o => o.type === 'mirror' && o.id !== 'light1' && o.id !== 'target1'); // avoid self?
    for (const obj of mirrors) {
      const seg = getMirrorSegment(obj);
      const inter = lineIntersect(origin, dir, seg.p1, seg.p2);
      if (inter.point && inter.t > 0.01 && inter.t < minT && dot(dir, seg.normal) < 0) {
        minT = inter.t;
        hitNormal = seg.normal;
        hitPoint = inter.point;
        hitType = 'mirror';
      }
    }

    // Prisms - circle approx
    const prisms = objects.filter(o => o.type === 'prism');
    for (const obj of prisms) {
      const oc = sub(obj.position, origin);
      const a = 1; // dir unit
      const b = 2 * dot(oc, dir);
      const c = dot(oc, oc) - (obj.size / 2) ** 2;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0.01) {
        t = (-b + Math.sqrt(disc)) / (2 * a);
      }
      if (t > 0.01 && t < minT) {
        const hitP = add(origin, scale(t, dir));
        const radialNormal = normalize(sub(hitP, obj.position));
        if (dot(dir, radialNormal) < 0) { // hitting from outside
          minT = t;
          hitNormal = radialNormal;
          hitPoint = hitP;
          hitType = 'prism';
        }
      }
    }

    if (hitPoint && minT < Infinity && hitType) {
      const end = add(origin, scale(minT, dir));
      segments.push({ start: { ...origin }, end: { ...end }, color: COLORS[colorIndex] });

      const n = normalize(hitNormal!);
      if (hitType === 'mirror') {
        dir = normalize(reflect(dir, n));
        origin = add(hitPoint, scale(0.1, n));
      } else if (hitType === 'prism') {
        const eta = 1 / REFRACTION_INDICES[colorIndex];
        const refracted = refract(dir, hitNormal!, eta);
        if (refracted) {
          dir = normalize(refracted);
        } else {
          dir = normalize(reflect(dir, n));
        }
        origin = add(hitPoint, scale(0.05, n)); // small step
      }
      totalLength += minT;
    } else {
      const remaining = maxLength - totalLength;
      if (remaining > 0) {
        const end = add(origin, scale(remaining, dir));
        segments.push({ start: { ...origin }, end: { ...end }, color: COLORS[colorIndex] });
      }
      break;
    }

    if (totalLength > maxLength) break;
  }

  return { segments };
}

const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];
const REFRACTION_INDICES = [1.331, 1.337, 1.343, 1.352, 1.369, 1.381, 1.393]; // Approximate for glass

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  const [objects, setObjects] = useState<OpticObject[]>([
    { id: 'light1', type: 'light', position: { x: 100, y: 300 }, rotation: 0, size: 20 },
    { id: 'target1', type: 'target', position: { x: 600, y: 100 }, rotation: 0, size: 30 }, // moved up for puzzle
  ]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Vector2>({ x: 0, y: 0 });
  const [puzzle, setPuzzle] = useState(1);
  const [solved, setSolved] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const context = canvas.getContext('2d');
      if (context) {
        setCtx(context);
        canvas.width = window.innerWidth - 40;
        canvas.height = window.innerHeight - 100;
      }
    }
  }, []);

  const addObject = useCallback((type: 'prism' | 'mirror') => {
    const newObj: OpticObject = {
      id: Date.now().toString(),
      type,
      position: { x: 300, y: 300 },
      rotation: 0,
      size: 40,
    };
    setObjects(prev => [...prev, newObj]);
  }, []);

  const computeRays = useCallback(() => {
    const allSegments: Array<{start: Vector2, end: Vector2, color: string}> = [];
    objects.filter(obj => obj.type === 'light').forEach(light => {
      COLORS.forEach((_, index) => {
        const {segments} = traceRay(light.position, {x: 1, y: 0}, index, objects);
        allSegments.push(...segments);
      });
    });
    return allSegments;
  }, [objects]);

  useEffect(() => {
    const segs = computeRays();
    const target = objects.find(o => o.type === 'target');
    if (target) {
      const hit = segs.some(seg => {
        const dx = seg.end.x - target.position.x;
        const dy = seg.end.y - target.position.y;
        return dx * dx + dy * dy < (target.size / 2 + 5) ** 2;
      });
      setSolved(hit);
    }
  }, [computeRays, objects]);

  const updatePosition = useCallback((id: string, pos: Vector2) => {
    setObjects(prev => prev.map(obj => obj.id === id ? { ...obj, position: pos } : obj));
  }, []);

  // Mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    for (const obj of objects) {
      const dist = Math.sqrt((x - obj.position.x)**2 + (y - obj.position.y)**2);
      if (dist < obj.size / 2 + 20) { // larger for rotation
        if (e.shiftKey) {
          setRotating(obj.id);
        } else {
          setDragging(obj.id);
        }
        break;
      }
    }
  }, [objects]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (dragging) {
      updatePosition(dragging, { x, y });
    } else if (rotating) {
      const obj = objects.find(o => o.id === rotating);
      if (obj) {
        const dx = x - obj.position.x;
        const dy = y - obj.position.y;
        const newRot = Math.atan2(dy, dx);
        setObjects(prev => prev.map(o => o.id === rotating ? { ...o, rotation: newRot } : o));
      }
    }
  }, [dragging, rotating, updatePosition, objects]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setRotating(null);
  }, []);

    // Drawing function
  const draw = useCallback(() => {
    if (!ctx) return;
    ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw objects
    objects.forEach(obj => {
      ctx.save();
      ctx.translate(obj.position.x, obj.position.y);
      ctx.rotate(obj.rotation);

      if (obj.type === 'light') {
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(0, 0, obj.size / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else if (obj.type === 'target') {
        ctx.fillStyle = solved ? 'gold' : 'green';
        ctx.beginPath();
        ctx.arc(0, 0, obj.size / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else if (obj.type === 'prism') {
        ctx.fillStyle = 'cyan';
        ctx.beginPath();
        ctx.moveTo(-obj.size / 2, 0);
        ctx.lineTo(obj.size / 2, -obj.size / 2);
        ctx.lineTo(obj.size / 2, obj.size / 2);
        ctx.closePath();
        ctx.fill();
      } else if (obj.type === 'mirror') {
        ctx.fillStyle = 'silver';
        ctx.fillRect(-obj.size / 2, -obj.size / 4, obj.size, obj.size / 2);
      }

      ctx.restore();
    });

    const allSegments: Array<{start: Vector2, end: Vector2, color: string}> = [];
    objects.filter(obj => obj.type === 'light').forEach(light => {
      COLORS.forEach((_, index) => {
        const {segments} = traceRay(light.position, {x: 1, y: 0}, index, objects);
        allSegments.push(...segments);
      });
    });
    allSegments.forEach(seg => {
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.lineTo(seg.end.x, seg.end.y);
      ctx.stroke();
    });
  }, [ctx, objects, solved]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas && ctx) {
        canvas.width = window.innerWidth - 40;
        canvas.height = window.innerHeight - 100;
        draw();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [ctx, draw]);

  // TODO: Ray tracing logic

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <h1 className="text-3xl font-bold mb-4 text-white">Light Ray Toy</h1>
      <div className="flex gap-4 mb-4">
        <button onClick={() => addObject('prism')} className="px-4 py-2 bg-blue-500 text-white rounded">Add Prism</button>
        <button onClick={() => addObject('mirror')} className="px-4 py-2 bg-gray-500 text-white rounded">Add Mirror</button>
        <button onClick={() => setObjects([
          { id: 'light1', type: 'light' as const, position: { x: 100, y: 300 }, rotation: 0, size: 20 },
          { id: 'target1', type: 'target' as const, position: { x: 600, y: 100 }, rotation: 0, size: 30 },
        ])} className="px-4 py-2 bg-green-500 text-white rounded">Puzzle 1</button>
        <div className={`ml-4 px-4 py-2 ${solved ? 'bg-green-600 text-green-200' : 'bg-red-600 text-red-200'}`}>
          {solved ? 'Solved!' : 'Not Solved - Guide light to target'}
        </div>
        <p className="ml-4 text-sm text-gray-300">Hold Shift + Drag to rotate objects</p>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="border rounded bg-gray-900"
      />
    </div>
  );
}
