"use client";

import { useEffect, useRef } from "react";

export type ViewerSource =
  | { kind: "demo"; variant: string; color: string }
  | { kind: "file"; name: string; buffer: ArrayBuffer; color: string };

export type ViewerStats = {
  triangles: number;
  vertices: number;
  faces?: number;
  quadRatio?: number;
  ngonCount?: number;
  boundaryEdges?: number;
  nonManifoldEdges?: number;
  degenerateFaces?: number;
  isolatedVertices?: number;
  poleRatio?: number;
  uvCoverage?: number;
  normalCoverage?: number;
  jointLoopScore?: number;
  jointLoopCounts?: { elbows: number; knees: number; waist: number };
  jointWarnings?: string[];
};
type Geometry = { positions: Float32Array; normals: Float32Array; lines: Float32Array; stats: ViewerStats };

const vertexShader = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vWorld;
void main(){
  vec4 world=uModel*vec4(aPosition,1.0);
  vWorld=world.xyz;
  vNormal=normalize(mat3(uModel)*aNormal);
  gl_Position=uMvp*vec4(aPosition,1.0);
}`;

const fragmentShader = `
precision highp float;
uniform vec3 uColor;
uniform float uWire;
varying vec3 vNormal;
varying vec3 vWorld;
void main(){
  vec3 light=normalize(vec3(-0.7,1.0,0.8));
  float diffuse=max(dot(normalize(vNormal),light),0.0);
  float rim=pow(1.0-max(dot(normalize(vNormal),normalize(vec3(0.0,0.2,1.0))),0.0),2.0);
  vec3 base=mix(uColor*0.24,uColor,0.28+diffuse*0.72)+rim*uColor*0.24;
  if(uWire>0.5) base=uColor;
  gl_FragColor=vec4(base,1.0);
}`;

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

function perspective(fov: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function translation(x: number, y: number, z: number) {
  const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m;
}

function rotationX(v: number) {
  const c = Math.cos(v), s = Math.sin(v); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY(v: number) {
  const c = Math.cos(v), s = Math.sin(v); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function normalizeGeometry(raw: number[]) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < raw.length; i += 3) {
    minX = Math.min(minX, raw[i]); maxX = Math.max(maxX, raw[i]);
    minY = Math.min(minY, raw[i + 1]); maxY = Math.max(maxY, raw[i + 1]);
    minZ = Math.min(minZ, raw[i + 2]); maxZ = Math.max(maxZ, raw[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  return raw.map((n, i) => (n - (i % 3 === 0 ? cx : i % 3 === 1 ? cy : cz)) * 2.55 / span);
}

function finalize(raw: number[]): Geometry {
  const positions = normalizeGeometry(raw), normals: number[] = [], lines: number[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    lines.push(ax, ay, az, bx, by, bz, bx, by, bz, cx, cy, cz, cx, cy, cz, ax, ay, az);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), lines: new Float32Array(lines), stats: { triangles: positions.length / 9, vertices: positions.length / 3 } };
}

type Point3 = [number, number, number];

function addTriangle(raw: number[], a: Point3, b: Point3, c: Point3) {
  raw.push(...a, ...b, ...c);
}

function addCylinder(raw: number[], start: Point3, end: Point3, startRadius: number, endRadius = startRadius, segments = 8) {
  const axis: Point3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const axisLength = Math.hypot(...axis) || 1;
  const direction: Point3 = [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength];
  const helper: Point3 = Math.abs(direction[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const sideA: Point3 = [
    direction[1] * helper[2] - direction[2] * helper[1],
    direction[2] * helper[0] - direction[0] * helper[2],
    direction[0] * helper[1] - direction[1] * helper[0],
  ];
  const sideLength = Math.hypot(...sideA) || 1;
  sideA[0] /= sideLength; sideA[1] /= sideLength; sideA[2] /= sideLength;
  const sideB: Point3 = [
    direction[1] * sideA[2] - direction[2] * sideA[1],
    direction[2] * sideA[0] - direction[0] * sideA[2],
    direction[0] * sideA[1] - direction[1] * sideA[0],
  ];
  const ring = (center: Point3, radius: number, index: number): Point3 => {
    const angle = index / segments * Math.PI * 2;
    return [
      center[0] + (sideA[0] * Math.cos(angle) + sideB[0] * Math.sin(angle)) * radius,
      center[1] + (sideA[1] * Math.cos(angle) + sideB[1] * Math.sin(angle)) * radius,
      center[2] + (sideA[2] * Math.cos(angle) + sideB[2] * Math.sin(angle)) * radius,
    ];
  };
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const a = ring(start, startRadius, i), b = ring(start, startRadius, next);
    const c = ring(end, endRadius, next), d = ring(end, endRadius, i);
    addTriangle(raw, a, b, c); addTriangle(raw, a, c, d);
    addTriangle(raw, start, b, a); addTriangle(raw, end, d, c);
  }
}

function addEllipsoid(raw: number[], center: Point3, radii: Point3, segments = 8, rings = 4, yaw = 0) {
  const point = (latitude: number, longitude: number): Point3 => {
    const y = Math.sin(latitude) * radii[1];
    const ringRadius = Math.cos(latitude);
    const x = Math.cos(longitude) * radii[0] * ringRadius;
    const z = Math.sin(longitude) * radii[2] * ringRadius;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return [center[0] + x * cos + z * sin, center[1] + y, center[2] - x * sin + z * cos];
  };
  const top: Point3 = [center[0], center[1] + radii[1], center[2]];
  const bottom: Point3 = [center[0], center[1] - radii[1], center[2]];
  const latitude = (ring: number) => Math.PI / 2 - ring / rings * Math.PI;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    addTriangle(raw, top, point(latitude(1), next / segments * Math.PI * 2), point(latitude(1), i / segments * Math.PI * 2));
    for (let ring = 1; ring < rings - 1; ring++) {
      const a = point(latitude(ring), i / segments * Math.PI * 2);
      const b = point(latitude(ring), next / segments * Math.PI * 2);
      const c = point(latitude(ring + 1), next / segments * Math.PI * 2);
      const d = point(latitude(ring + 1), i / segments * Math.PI * 2);
      addTriangle(raw, a, b, c); addTriangle(raw, a, c, d);
    }
    addTriangle(raw, bottom, point(latitude(rings - 1), i / segments * Math.PI * 2), point(latitude(rings - 1), next / segments * Math.PI * 2));
  }
}

function addWedge(raw: number[], center: Point3, size: Point3, tilt = 0) {
  const [cx, cy, cz] = center, [sx, sy, sz] = size, cos = Math.cos(tilt), sin = Math.sin(tilt);
  const transform = (x: number, y: number, z: number): Point3 => [cx + x * cos - y * sin, cy + x * sin + y * cos, cz + z];
  const vertices = [
    transform(-sx / 2, -sy / 2, -sz / 2), transform(sx / 2, -sy / 2, -sz / 2), transform(-sx / 2, sy / 2, -sz / 2),
    transform(-sx / 2, -sy / 2, sz / 2), transform(sx / 2, -sy / 2, sz / 2), transform(-sx / 2, sy / 2, sz / 2),
  ];
  const triangles = [0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2];
  for (let i = 0; i < triangles.length; i += 3) addTriangle(raw, vertices[triangles[i]], vertices[triangles[i + 1]], vertices[triangles[i + 2]]);
}

function demoGeometry(variant: string) {
  const raw: number[] = [];
  if (variant === "prop") {
    addCylinder(raw, [-.38, -1.25, 0], [.12, 1.05, 0], .105, .08, 8);
    addCylinder(raw, [-.43, -1.42, 0], [-.34, -1.12, 0], .18, .12, 8);
    addCylinder(raw, [.04, .86, 0], [.22, 1.12, 0], .18, .15, 8);
    addWedge(raw, [.56, .83, 0], [1.18, .78, .16], -.24);
    addWedge(raw, [.30, .52, 0], [.64, .5, .14], .34);
  } else if (variant === "vehicle") {
    addCylinder(raw, [-.86, -.47, -.26], [-.86, -.47, .26], .46, .46, 10);
    addCylinder(raw, [.90, -.47, -.26], [.90, -.47, .26], .46, .46, 10);
    addEllipsoid(raw, [0, .02, 0], [1.16, .3, .34], 10, 3);
    addEllipsoid(raw, [-.12, .43, 0], [.58, .3, .35], 8, 3, -.08);
    addCylinder(raw, [.56, -.18, -.18], [.86, .28, -.18], .07, .055, 6);
    addCylinder(raw, [.56, -.18, .18], [.86, .28, .18], .07, .055, 6);
    addCylinder(raw, [.84, .22, 0], [.77, .76, 0], .055, .045, 6);
    addCylinder(raw, [.52, .75, 0], [1.00, .75, 0], .045, .045, 6);
    addWedge(raw, [-.48, .48, 0], [.72, .18, .46], 0);
    addWedge(raw, [.98, .16, 0], [.44, .18, .5], .08);
  } else if (variant === "env") {
    addEllipsoid(raw, [0, -.92, 0], [1.5, .3, 1.08], 12, 3);
    addCylinder(raw, [-.82, -.72, 0], [-.82, .75, 0], .14, .11, 8);
    addCylinder(raw, [.82, -.72, 0], [.82, .75, 0], .14, .11, 8);
    addCylinder(raw, [-1.08, .63, 0], [1.08, .63, 0], .13, .13, 8);
    addCylinder(raw, [-.92, .89, 0], [.92, .89, 0], .1, .1, 8);
    addWedge(raw, [0, 1.17, 0], [2.35, .42, .76], 0);
    addWedge(raw, [0, 1.46, 0], [1.62, .34, .62], 0);
    addWedge(raw, [0, -.63, .1], [1.25, .22, .92], 0);
    addEllipsoid(raw, [-1.16, -.62, .52], [.4, .5, .34], 7, 3, .35);
    addEllipsoid(raw, [1.12, -.68, -.42], [.46, .38, .3], 7, 3, -.2);
  } else if (variant === "beast") {
    addEllipsoid(raw, [0, .15, 0], [.86, .42, .38], 8, 3);
    addEllipsoid(raw, [.74, .34, 0], [.45, .36, .34], 8, 3);
    addWedge(raw, [1.12, .24, 0], [.58, .34, .42], 0);
    addCylinder(raw, [-.62, .12, 0], [-1.18, .46, 0], .12, .05, 6);
    [[-.55, -.1], [.48, -.1]].forEach(([x, z]) => {
      addCylinder(raw, [x, -.05, z], [x, -.64, z], .13, .105, 7);
      addEllipsoid(raw, [x, -.67, z], [.16, .15, .16], 7, 3);
      addCylinder(raw, [x, -.74, z], [x + .08, -1.28, z], .1, .07, 7);
      addWedge(raw, [x + .16, -1.38, z], [.48, .18, .26], 0);
    });
    addWedge(raw, [.62, .74, -.18], [.26, .42, .1], .22);
    addWedge(raw, [.62, .74, .18], [.26, .42, .1], .22);
  } else {
    addEllipsoid(raw, [0, .92, 0], [.34, .4, .32], 8, 4);
    addCylinder(raw, [0, .48, 0], [0, .66, 0], .15, .15, 8);
    addCylinder(raw, [0, -.38, 0], [0, .48, 0], .38, .5, 8);
    addCylinder(raw, [0, -.72, 0], [0, -.38, 0], .37, .34, 8);
    [[-1, -.02], [1, .02]].forEach(([side, z]) => {
      const shoulder: Point3 = [side * .47, .34, z];
      const elbow: Point3 = [side * .72, -.1, z + .03];
      const wrist: Point3 = [side * .74, -.58, z + .08];
      addEllipsoid(raw, shoulder, [.19, .19, .2], 7, 3);
      addCylinder(raw, shoulder, elbow, .16, .125, 7);
      addEllipsoid(raw, elbow, [.14, .14, .15], 7, 3);
      addCylinder(raw, elbow, wrist, .12, .09, 7);
      addEllipsoid(raw, wrist, [.11, .16, .12], 7, 3);
    });
    [[-1, -.05], [1, .05]].forEach(([side, z]) => {
      const hip: Point3 = [side * .23, -.66, z];
      const knee: Point3 = [side * .27, -1.19, z + .02];
      const ankle: Point3 = [side * .28, -1.68, z + .06];
      addEllipsoid(raw, hip, [.18, .18, .19], 7, 3);
      addCylinder(raw, hip, knee, .17, .135, 7);
      addEllipsoid(raw, knee, [.145, .14, .15], 7, 3);
      addCylinder(raw, knee, ankle, .13, .09, 7);
      addWedge(raw, [side * .28, -1.79, .17], [.34, .2, .54], 0);
    });
    addWedge(raw, [0, 1.13, -.25], [.5, .24, .12], 0);
  }
  return finalize(raw);
}

function parseObj(name: string, buffer: ArrayBuffer): Geometry {
  if (!name.toLowerCase().endsWith(".obj")) throw new Error("请选择 Wavefront OBJ 模型文件");
  const vertices: number[][] = [], raw: number[] = [], faces: number[][] = [];
  let uvCount = 0, normalCount = 0, referencedUvCorners = 0, referencedNormalCorners = 0, totalCorners = 0, degenerateFaces = 0;
  const lines = new TextDecoder().decode(buffer).split(/\r?\n/);
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) {
      const point = parts.slice(1,4).map(Number);
      if (point.every(Number.isFinite)) vertices.push(point);
    } else if (parts[0] === "vt" && parts.length >= 3) {
      uvCount++;
    } else if (parts[0] === "vn" && parts.length >= 4) {
      normalCount++;
    } else if (parts[0] === "f" && parts.length >= 4) {
      const tokens = parts.slice(1);
      totalCorners += tokens.length;
      const face = tokens.map((token) => {
        const refs = token.split("/");
        if (refs[1]) referencedUvCorners++;
        if (refs[2]) referencedNormalCorners++;
        const value = Number(refs[0]);
        return value < 0 ? vertices.length + value : value - 1;
      });
      if (face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) throw new Error("OBJ 面片引用了无效顶点索引");
      faces.push(face);
      if (new Set(face).size < 3) degenerateFaces++;
      for (let i = 1; i < face.length - 1; i++) raw.push(...vertices[face[0]], ...vertices[face[i]], ...vertices[face[i + 1]]);
    }
  }
  if (!vertices.length) throw new Error("OBJ 文件中没有顶点数据");
  if (!raw.length) throw new Error("OBJ 文件中没有可显示的面片");
  const geometry = finalize(raw);
  const edgeUse = new Map<string, number>(), used = new Set<number>();
  const neighbors = Array.from({ length: vertices.length }, () => new Set<number>());
  for (const face of faces) {
    face.forEach((index) => used.add(index));
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
      neighbors[a].add(b); neighbors[b].add(a);
    }
  }
  const boundaryEdges = [...edgeUse.values()].filter((count) => count === 1).length;
  const nonManifoldEdges = [...edgeUse.values()].filter((count) => count > 2).length;
  const poles = [...used].filter((index) => neighbors[index].size < 3 || neighbors[index].size > 6).length;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of vertices) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  const size = [0, 1, 2].map((axis) => Math.max(1e-6, max[axis] - min[axis]));
  const normalized = vertices.map((point) => [
    (point[0] - min[0]) / size[1] - size[0] / size[1] / 2,
    (point[1] - min[1]) / size[1],
    (point[2] - min[2]) / size[1] - size[2] / size[1] / 2,
  ]);
  const countBands = (candidates: number[]) => {
    candidates.sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const value of candidates) {
      const cluster = clusters[clusters.length - 1];
      if (!cluster || value - cluster[cluster.length - 1] > .009) clusters.push([value]);
      else cluster.push(value);
    }
    return Math.min(5, clusters.filter((cluster) => cluster.length >= 5).length);
  };
  const halfWidth = size[0] / size[1] / 2;
  const armReach = Math.max(.01, halfWidth - .18);
  const elbowTarget = .18 + armReach * .52;
  const jointCandidates = { leftElbow: [] as number[], rightElbow: [] as number[], knees: [] as number[], waist: [] as number[] };
  for (const key of edgeUse.keys()) {
    const separator = key.indexOf(":");
    const a = Number(key.slice(0, separator)), b = Number(key.slice(separator + 1));
    const pa = normalized[a], pb = normalized[b];
    const xMid = (pa[0] + pb[0]) / 2, yMid = (pa[1] + pb[1]) / 2;
    if (Math.abs(pa[0] - pb[0]) <= .012 && pa[1] > .47 && pa[1] < .82 && pb[1] > .47 && pb[1] < .82) {
      if (pa[0] < -.16 && pb[0] < -.16 && Math.abs(xMid + elbowTarget) <= .075) jointCandidates.leftElbow.push(xMid);
      if (pa[0] > .16 && pb[0] > .16 && Math.abs(xMid - elbowTarget) <= .075) jointCandidates.rightElbow.push(xMid);
    }
    if (Math.abs(pa[1] - pb[1]) <= .012 && Math.abs(yMid - .265) <= .075) {
      if (Math.abs(pa[0]) > .035 && Math.abs(pa[0]) < .28 && Math.abs(pb[0]) > .035 && Math.abs(pb[0]) < .28) jointCandidates.knees.push(yMid);
    }
    if (Math.abs(pa[1] - pb[1]) <= .012 && Math.abs(yMid - .52) <= .065) {
      if (Math.abs(pa[0]) < .24 && Math.abs(pb[0]) < .24) jointCandidates.waist.push(yMid);
    }
  }
  const leftElbow = countBands(jointCandidates.leftElbow);
  const rightElbow = countBands(jointCandidates.rightElbow);
  const elbows = Math.min(leftElbow, rightElbow);
  const knees = countBands(jointCandidates.knees);
  const waist = countBands(jointCandidates.waist);
  const jointLoopCounts = { elbows, knees, waist };
  const jointLoopScore = (Math.min(elbows, 3) + Math.min(knees, 3) + Math.min(waist, 3)) / 9;
  const jointWarnings = [
    elbows < 3 ? "手肘环线不足" : "",
    knees < 3 ? "膝盖环线不足" : "",
    waist < 3 ? "腰部环线不足" : "",
  ].filter(Boolean);
  geometry.stats = {
    triangles: geometry.stats.triangles,
    vertices: vertices.length,
    faces: faces.length,
    quadRatio: faces.filter((face) => face.length === 4).length / faces.length,
    ngonCount: faces.filter((face) => face.length > 4).length,
    boundaryEdges,
    nonManifoldEdges,
    degenerateFaces,
    isolatedVertices: vertices.length - used.size,
    poleRatio: used.size ? poles / used.size : 1,
    uvCoverage: uvCount && totalCorners ? referencedUvCorners / totalCorners : 0,
    normalCoverage: normalCount && totalCorners ? referencedNormalCorners / totalCorners : 0,
    jointLoopScore,
    jointLoopCounts,
    jointWarnings,
  };
  return geometry;
}

export function analyzeObj(name: string, buffer: ArrayBuffer): ViewerStats {
  return parseObj(name, buffer).stats;
}

function parseFile(name: string, buffer: ArrayBuffer): Geometry {
  return parseObj(name, buffer);
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader=gl.createShader(type)!; gl.shaderSource(shader,source); gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader 编译失败"); return shader;
}

function hexColor(hex: string) {
  const value=parseInt(hex.replace("#",""),16); return [(value>>16&255)/255,(value>>8&255)/255,(value&255)/255];
}

export default function ModelViewer({ source, mode="solid", compact=false, onStats, onError }: { source: ViewerSource; mode?: "solid"|"wireframe"|"normal"; compact?: boolean; onStats?: (stats: ViewerStats)=>void; onError?: (message:string)=>void }) {
  const canvasRef=useRef<HTMLCanvasElement>(null), rotation=useRef({x:-.12,y:.55,distance:4.2}), drag=useRef({active:false,x:0,y:0});
  const sourceKind=source.kind, sourceColor=source.color;
  const sourceName=source.kind === "file" ? source.name : "";
  const sourceBuffer=source.kind === "file" ? source.buffer : null;
  const sourceVariant=source.kind === "demo" ? source.variant : "";
  useEffect(() => {
    const canvas=canvasRef.current; if(!canvas) return;
    const gl=canvas.getContext("webgl",{antialias:true,alpha:true}); if(!gl){onError?.("当前浏览器不支持 WebGL"); return;}
    let geometry: Geometry;
    try { geometry=sourceKind === "file" ? parseFile(sourceName,sourceBuffer!) : demoGeometry(sourceVariant); onStats?.(geometry.stats); }
    catch(error){onError?.(error instanceof Error ? error.message : "模型解析失败"); geometry=demoGeometry("char");}
    const program=gl.createProgram()!; gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,vertexShader)); gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,fragmentShader)); gl.linkProgram(program); gl.useProgram(program);
    const pos=gl.getAttribLocation(program,"aPosition"), normal=gl.getAttribLocation(program,"aNormal");
    const positionBuffer=gl.createBuffer(), normalBuffer=gl.createBuffer(), lineBuffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer); gl.bufferData(gl.ARRAY_BUFFER,geometry.positions,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,normalBuffer); gl.bufferData(gl.ARRAY_BUFFER,geometry.normals,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer); gl.bufferData(gl.ARRAY_BUFFER,geometry.lines,gl.STATIC_DRAW);
    const color=hexColor(mode === "normal" ? "#79a8ff" : sourceColor); let frame=0;
    const render=() => {
      const dpr=Math.min(devicePixelRatio,2), w=Math.max(1,canvas.clientWidth), h=Math.max(1,canvas.clientHeight);
      if(canvas.width!==w*dpr || canvas.height!==h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;}
      gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor(0.025,0.035,0.034,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      const model=multiply(rotationY(rotation.current.y),rotationX(rotation.current.x)), view=translation(0,0,-rotation.current.distance), projection=perspective(Math.PI/4,canvas.width/canvas.height,.1,100), mvp=multiply(projection,multiply(view,model));
      gl.uniformMatrix4fv(gl.getUniformLocation(program,"uMvp"),false,mvp); gl.uniformMatrix4fv(gl.getUniformLocation(program,"uModel"),false,model); gl.uniform3fv(gl.getUniformLocation(program,"uColor"),color);
      if(mode==="wireframe"){
        gl.disable(gl.CULL_FACE); gl.uniform1f(gl.getUniformLocation(program,"uWire"),1); gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,3,gl.FLOAT,false,0,0); gl.disableVertexAttribArray(normal); gl.vertexAttrib3f(normal,0,0,1); gl.drawArrays(gl.LINES,0,geometry.lines.length/3);
      } else {
        gl.uniform1f(gl.getUniformLocation(program,"uWire"),0); gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,3,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER,normalBuffer); gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal,3,gl.FLOAT,false,0,0); gl.drawArrays(gl.TRIANGLES,0,geometry.positions.length/3);
      }
      frame=requestAnimationFrame(render);
    }; render();
    return () => {cancelAnimationFrame(frame); gl.deleteProgram(program); gl.deleteBuffer(positionBuffer);gl.deleteBuffer(normalBuffer);gl.deleteBuffer(lineBuffer);};
  },[sourceKind,sourceName,sourceBuffer,sourceVariant,sourceColor,mode,onStats,onError]);
  return <div className={`webgl-viewer ${compact ? "compact" : ""}`}>
    <canvas ref={canvasRef} aria-label={source.kind === "file" ? `${source.name} 3D 模型预览` : "低模游戏资产 3D 预览"}
      onPointerDown={e=>{drag.current={active:true,x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)}}
      onPointerMove={e=>{if(!drag.current.active)return;rotation.current.y+=(e.clientX-drag.current.x)*.01;rotation.current.x+=(e.clientY-drag.current.y)*.01;drag.current.x=e.clientX;drag.current.y=e.clientY}}
      onPointerUp={()=>{drag.current.active=false}} onPointerCancel={()=>{drag.current.active=false}}
      onWheel={e=>{e.preventDefault();rotation.current.distance=Math.max(2.4,Math.min(8,rotation.current.distance+e.deltaY*.004))}} />
    {!compact && <><div className="viewer-badge">WEBGL · REALTIME</div><div className="viewer-help">拖动旋转 · 滚轮缩放</div></>}
  </div>;
}
