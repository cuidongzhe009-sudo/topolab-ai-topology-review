"use client";

import { useEffect, useRef } from "react";

export type ViewerSource =
  | { kind: "demo"; variant: string; color: string }
  | { kind: "file"; name: string; buffer: ArrayBuffer; color: string };

type ViewerStats = { triangles: number; vertices: number };
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

function addBox(raw: number[], center: number[], size: number[], tilt = 0) {
  const [cx, cy, cz] = center, [sx, sy, sz] = size;
  const base = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([x,y,z]) => {
    const px=x*sx/2, py=y*sy/2, pz=z*sz/2, c=Math.cos(tilt), s=Math.sin(tilt);
    return [cx+px*c-py*s,cy+px*s+py*c,cz+pz];
  });
  const faces = [0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
  faces.forEach(i => raw.push(...base[i]));
}

function demoGeometry(variant: string) {
  const raw: number[] = [], wide = variant === "vehicle", prop = variant === "prop", env = variant === "env";
  if (prop) {
    addBox(raw,[0,0,0],[.24,2.4,.24],-.18); addBox(raw,[.45,.8,0],[1.35,.7,.18],-.48); addBox(raw,[-.23,-1.1,0],[.58,.38,.34],-.18);
  } else if (wide) {
    addBox(raw,[0,.15,0],[2.5,.48,1]); addBox(raw,[.15,.62,0],[1.15,.62,.82]);
    addBox(raw,[-.82,-.43,.58],[.5,.8,.24]); addBox(raw,[.82,-.43,.58],[.5,.8,.24]); addBox(raw,[-.82,-.43,-.58],[.5,.8,.24]); addBox(raw,[.82,-.43,-.58],[.5,.8,.24]);
  } else if (env) {
    addBox(raw,[0,-1,0],[2.7,.28,1.5]); addBox(raw,[-.78,0,0],[.34,2,.34]); addBox(raw,[.78,0,0],[.34,2,.34]); addBox(raw,[0,.92,0],[2,.35,.5]); addBox(raw,[0,1.35,0],[1.25,.3,.45]);
  } else {
    addBox(raw,[0,.72,0],[.72,.72,.58]); addBox(raw,[0,-.05,0],[1.02,.92,.58]); addBox(raw,[0,-.72,0],[.78,.48,.48]);
    addBox(raw,[-.72,.03,0],[.34,1.06,.36],.12); addBox(raw,[.72,.03,0],[.34,1.06,.36],-.12);
    addBox(raw,[-.28,-1.22,0],[.38,1.05,.42],.035); addBox(raw,[.28,-1.22,0],[.38,1.05,.42],-.035);
    addBox(raw,[-.28,-1.85,.08],[.48,.28,.82]); addBox(raw,[.28,-1.85,.08],[.48,.28,.82]);
    addBox(raw,[0,.66,.38],[.34,.18,.2]); addBox(raw,[-.36,.78,.22],[.13,.13,.13]); addBox(raw,[.36,.78,.22],[.13,.13,.13]);
  }
  return finalize(raw);
}

function parseObj(name: string, buffer: ArrayBuffer): Geometry {
  if (!name.toLowerCase().endsWith(".obj")) throw new Error("请选择 Wavefront OBJ 模型文件");
  const vertices: number[][] = [], raw: number[] = [];
  const lines = new TextDecoder().decode(buffer).split(/\r?\n/);
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) {
      const point = parts.slice(1,4).map(Number);
      if (point.every(Number.isFinite)) vertices.push(point);
    } else if (parts[0] === "f" && parts.length >= 4) {
      const face = parts.slice(1).map((token) => {
        const value = Number(token.split("/")[0]);
        return value < 0 ? vertices.length + value : value - 1;
      });
      if (face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) throw new Error("OBJ 面片引用了无效顶点索引");
      for (let i = 1; i < face.length - 1; i++) raw.push(...vertices[face[0]], ...vertices[face[i]], ...vertices[face[i + 1]]);
    }
  }
  if (!vertices.length) throw new Error("OBJ 文件中没有顶点数据");
  if (!raw.length) throw new Error("OBJ 文件中没有可显示的面片");
  const geometry = finalize(raw);
  geometry.stats.vertices = vertices.length;
  return geometry;
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
