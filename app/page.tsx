"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ModelViewer, { analyzeObj, type ViewerSource, type ViewerStats } from "./ModelViewer";

type Model = {
  id: number;
  name: string;
  type: string;
  score: number;
  tris: string;
  verts: string;
  texture: string;
  poly: "char" | "prop" | "env" | "vehicle";
  color: string;
  quality: number[];
  local?: boolean;
  audit?: { quadRatio: number; boundaryEdges: number; nonManifoldEdges: number; ngonCount: number };
};

type UploadedAsset = { model: Model; fileName: string; buffer: ArrayBuffer };

const standards = [
  { name: "轮廓还原", weight: 15, detail: "关键动作视角下轮廓与体块稳定", value: 92 },
  { name: "变形边流", weight: 25, detail: "边流顺应肌肉走向与关节弯曲轴", value: 88 },
  { name: "绑定适配", weight: 25, detail: "肩、肘、髋、膝有连续环线与权重缓冲带", value: 87 },
  { name: "面数效率", weight: 15, detail: "变形区有预算，刚性区不堆叠无效边", value: 86 },
  { name: "拓扑健康", weight: 10, detail: "避免非流形、退化面、孤立点与高风险极点", value: 90 },
  { name: "UV / 法线", weight: 10, detail: "接缝避开拉伸区，法线与烘焙连续", value: 94 },
];

const models: Model[] = [
  { id: 1, name: "KAI / Hero", type: "角色", score: 91, tris: "18.4K", verts: "9.7K", texture: "2K × 3", poly: "char", color: "#d8ff4f", quality: [94, 92, 91, 86, 90, 93] },
  { id: 2, name: "Ranger-07", type: "角色", score: 82, tris: "22.1K", verts: "11.8K", texture: "2K × 3", poly: "char", color: "#ffb86b", quality: [88, 82, 76, 72, 84, 91] },
  { id: 3, name: "Scout Bike", type: "载具", score: 87, tris: "31.6K", verts: "16.2K", texture: "4K × 2", poly: "vehicle", color: "#79a8ff", quality: [92, 86, 84, 88, 90, 90] },
  { id: 4, name: "Forest Shrine", type: "场景", score: 78, tris: "46.8K", verts: "24.1K", texture: "2K × 5", poly: "env", color: "#bf94ff", quality: [83, 76, 72, 75, 78, 85] },
  { id: 5, name: "Plasma Axe", type: "道具", score: 93, tris: "6.2K", verts: "3.4K", texture: "2K × 2", poly: "prop", color: "#72efd0", quality: [96, 93, 90, 95, 94, 96] },
  { id: 6, name: "Mech Hound", type: "角色", score: 73, tris: "28.9K", verts: "15.3K", texture: "2K × 4", poly: "char", color: "#ff7c8c", quality: [82, 72, 62, 66, 74, 86] },
];

const labels = ["轮廓", "变形边流", "绑定适配", "效率", "拓扑健康", "UV/法线"];
const uploadColors = ["#d8ff4f", "#79a8ff", "#ffb86b", "#bf94ff", "#72efd0", "#ff7c8c"];

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const formatCount = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);

function qualityFromStats(stats: ViewerStats) {
  const faces = Math.max(1, stats.faces || stats.triangles);
  const quadRatio = stats.quadRatio || 0;
  const poleRatio = stats.poleRatio || 0;
  const boundaryPressure = (stats.boundaryEdges || 0) / Math.max(1, faces * 2);
  const topologyPenalty = (stats.nonManifoldEdges || 0) * 18 + (stats.degenerateFaces || 0) * 12 + (stats.isolatedVertices || 0) * 4;
  const silhouette = clamp(86 + Math.min(8, Math.log10(Math.max(10, stats.vertices)) * 3) - (stats.degenerateFaces || 0) * 3);
  const deformationFlow = clamp(52 + quadRatio * 43 - poleRatio * 22 - (stats.ngonCount || 0) / faces * 30);
  const rigReadiness = clamp(58 + quadRatio * 38 - poleRatio * 18 - boundaryPressure * 14 - topologyPenalty);
  const efficiency = clamp(96 - Math.max(0, stats.triangles - 50000) / 1800 - (stats.isolatedVertices || 0) * 2);
  const topologyHealth = clamp(98 - topologyPenalty - boundaryPressure * 10);
  const surface = clamp(55 + (stats.uvCoverage || 0) * 25 + (stats.normalCoverage || 0) * 20);
  return [silhouette, deformationFlow, rigReadiness, efficiency, topologyHealth, surface];
}

function weightedScore(quality: number[]) {
  return Math.round(quality.reduce((sum, value, index) => sum + value * standards[index].weight / 100, 0));
}

function ScoreRing({ score, small = false }: { score: number; small?: boolean }) {
  return <div className={`score-ring ${small ? "small" : ""}`} style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><strong>{score}</strong><span>{small ? "" : "综合分"}</span></div>;
}

export default function Home() {
  const [tab, setTab] = useState("overview");
  const [filter, setFilter] = useState("全部");
  const [selected, setSelected] = useState(models[0]);
  const [leftId, setLeftId] = useState(1);
  const [rightId, setRightId] = useState(2);
  const [scores, setScores] = useState([94, 92, 91, 86, 90, 93]);
  const [view, setView] = useState("线框");
  const [toast, setToast] = useState("");
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const nextUploadId = useRef(1000);

  const total = useMemo(() => Math.round(scores.reduce((sum, n, i) => sum + n * standards[i].weight / 100, 0)), [scores]);
  const libraryModels = useMemo(() => [...uploadedAssets.map((asset) => asset.model), ...models], [uploadedAssets]);
  const left = libraryModels.find((m) => m.id === leftId) || libraryModels[0];
  const right = libraryModels.find((m) => m.id === rightId) || libraryModels.find((m) => m.id !== left.id) || libraryModels[0];
  const filtered = filter === "全部" ? libraryModels : libraryModels.filter((m) => m.type === filter);
  const navigate = (next: string) => { setTab(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2200); };
  const viewerSource = (model: Model): ViewerSource => {
    const asset = uploadedAssets.find((candidate) => candidate.model.id === model.id);
    return asset
      ? { kind: "file", name: asset.fileName, buffer: asset.buffer, color: asset.model.color }
      : { kind: "demo", variant: model.poly, color: model.color };
  };
  const reportViewerError = useCallback((message: string) => notify(message), []);
  const uploadModels = async (files?: FileList | null) => {
    if (!files?.length) return;
    const created: UploadedAsset[] = [];
    for (const file of Array.from(files)) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension !== "obj") { notify(`${file.name} 不是 .obj 文件`); continue; }
      if (file.size > 50 * 1024 * 1024) { notify(`${file.name} 超过 50MB`); continue; }
      try {
        const buffer = await file.arrayBuffer();
        const stats = analyzeObj(file.name, buffer);
        const quality = qualityFromStats(stats);
        const id = nextUploadId.current++;
        const model: Model = {
          id,
          name: file.name.replace(/\.obj$/i, ""),
          type: "本地角色",
          score: weightedScore(quality),
          tris: formatCount(stats.triangles),
          verts: formatCount(stats.vertices),
          texture: `${Math.round((stats.uvCoverage || 0) * 100)}% UV`,
          poly: "char",
          color: uploadColors[(id - 1000) % uploadColors.length],
          quality,
          local: true,
          audit: {
            quadRatio: stats.quadRatio || 0,
            boundaryEdges: stats.boundaryEdges || 0,
            nonManifoldEdges: stats.nonManifoldEdges || 0,
            ngonCount: stats.ngonCount || 0,
          },
        };
        created.push({ model, fileName: file.name, buffer });
      } catch (error) {
        notify(error instanceof Error ? `${file.name}：${error.message}` : `${file.name} 解析失败`);
      }
    }
    if (!created.length) return;
    setUploadedAssets((current) => [...created, ...current]);
    setSelected(created[created.length - 1].model);
    setLeftId(created[0].model.id);
    if (created.length > 1) setRightId(created[1].model.id);
    if (tab !== "pk") setTab("models");
    notify(`已保留并载入 ${created.length} 个本地 OBJ 模型`);
  };

  return (
    <main>
      <input ref={uploadRef} className="file-input" type="file" accept=".obj,model/obj,text/plain" multiple onChange={(event) => { void uploadModels(event.target.files); event.currentTarget.value = ""; }} />
      <header>
        <button className="brand" onClick={() => navigate("overview")} aria-label="返回概览"><span className="brandmark">T</span><span>TOPO<span>LAB</span></span></button>
        <nav aria-label="主导航">
          {[["overview", "标准与概览"], ["models", "模型浏览"], ["evaluate", "质量评分"], ["pk", "模型 PK"]].map(([id, name]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => navigate(id)}>{name}</button>
          ))}
        </nav>
        <div className="header-actions"><span className="demo-dot" /> DEMO DATA <button className="ghost" onClick={() => notify("报告已加入导出队列（Demo）")}>导出报告</button></div>
      </header>

      {tab === "overview" && <>
        <section className="hero">
          <div className="eyebrow"><span /> AI-ASSISTED TOPOLOGY REVIEW · V1.0</div>
          <h1>让每一个面，<br />都<strong>有据可评。</strong></h1>
          <p>将“看起来不错”转化为可对齐、可解释、可追踪的低模质量标准。面向游戏美术、外包验收与模型优化团队。</p>
          <div className="hero-actions"><button className="primary" onClick={() => navigate("evaluate")}>开始评测 <b>↗</b></button><button className="secondary" onClick={() => navigate("models")}>浏览样例模型</button></div>
          <div className="hero-metrics"><div><b>28</b><span>本周评测</span></div><div><b>86.4</b><span>平均质量分</span></div><div><b>↑ 6.8%</b><span>优化后提升</span></div></div>
          <div className="hero-visual"><ModelViewer source={viewerSource(models[0])} /><div className="scan-line" /><div className="callout c1"><span>01</span> 肩部环线连续</div><div className="callout c2"><span>02</span> 肘部预留 3 环</div><div className="callout c3 warning"><span>!</span> 腰侧密度偏高</div><div className="visual-caption">LOWPOLY_SCOUT.OBJ <b>REALTIME WEBGL</b></div></div>
        </section>

        <section className="standard-section">
          <div className="section-head"><div><span className="index">01 / EVALUATION FRAMEWORK</span><h2>一套面向动画绑定的<br />评测标准</h2></div><p>围绕骨骼轴、关节环线、权重缓冲带和极限姿态设定标准，让布线真正服务游戏动画。</p></div>
          <div className="standards-grid">
            {standards.map((s, i) => <article className="standard-card" key={s.name}><div className="standard-top"><span>0{i + 1}</span><b>{s.weight}%</b></div><div className="mini-shape"><i /><i /><i /></div><h3>{s.name}</h3><p>{s.detail}</p><div className="bar"><i style={{ width: `${s.value}%` }} /></div><small>样例均值 {s.value}</small></article>)}
          </div>
          <div className="rig-note"><b>动画绑定检查重点</b><span>肩胛滑动 · 肘膝折叠 · 髋部扭转 · 手腕/脚踝权重过渡 · 极点远离主弯曲区</span><small>OBJ 不包含骨骼和蒙皮权重；“绑定适配”评估的是网格可绑定性，最终仍需在引擎中做动作测试。</small></div>
        </section>

        <section className="insights">
          <div className="section-head"><div><span className="index">02 / QUALITY INTELLIGENCE</span><h2>从评分到决策</h2></div><button className="text-link" onClick={() => navigate("pk")}>进入对比评测 →</button></div>
          <div className="dashboard-grid">
            <article className="chart-card wide"><div className="card-title"><div><span>近 8 周质量趋势</span><b>团队平均分</b></div><strong>86.4 <em>+6.8%</em></strong></div><div className="line-chart"><div className="grid-lines" />{[52, 47, 42, 45, 35, 31, 26, 19].map((v, i) => <i key={i} style={{ left: `${i * 14.28}%`, top: `${v}%` }}><span>{[78, 80, 82, 81, 84, 85, 86, 88][i]}</span></i>)}</div><div className="week-labels">{["W21", "W22", "W23", "W24", "W25", "W26", "W27", "W28"].map(w => <span key={w}>{w}</span>)}</div></article>
            <article className="chart-card"><div className="card-title"><div><span>质量分布</span><b>全部 64 个模型</b></div></div><div className="distribution"><div className="donut"><strong>64</strong><span>模型</span></div><ul><li><i className="excellent" />优秀 90+ <b>18</b></li><li><i className="good" />良好 80–89 <b>29</b></li><li><i className="risk" />待优化 &lt;80 <b>17</b></li></ul></div></article>
            <article className="chart-card issue-card"><div className="card-title"><div><span>高频问题 TOP 3</span><b>AI 复核建议</b></div></div><ol><li><span>01</span><div>关节环线不足<small>11 个模型 · 变形风险</small></div><b>高</b></li><li><span>02</span><div>局部面密度失衡<small>9 个模型 · 性能浪费</small></div><b>中</b></li><li><span>03</span><div>UV 接缝穿越主视区<small>6 个模型 · 贴图风险</small></div><b>中</b></li></ol></article>
          </div>
        </section>
      </>}

      {tab === "models" && <section className="workspace-section">
        <div className="page-title"><div><span className="index">MODEL LIBRARY / GAME ASSETS</span><h1>模型浏览</h1><p>可连续上传多个 Wavefront OBJ；每个模型都会保留在本地模型库，并生成面向动画绑定的拓扑评分。</p></div><div className="upload-actions"><button className="primary" onClick={() => uploadRef.current?.click()}>＋ 上传一个或多个 OBJ</button><small>不会覆盖已有模型 · 单文件最大 50MB · 不离开本机</small></div></div>
        <div className="filters">{["全部", "本地角色", "角色", "载具", "场景", "道具"].map(f => <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>
        <div className="model-layout"><div className="model-grid">{filtered.map(m => <button key={m.id} className={`model-card ${selected.id === m.id ? "selected" : ""}`} onClick={() => setSelected(m)}><div className="model-preview"><ModelViewer source={viewerSource(m)} compact /><ScoreRing score={m.score} small /></div><div className="model-info"><div><b>{m.name}</b><span>{m.type} · {m.local ? "LOCAL OBJ" : "GAME ASSET"}</span></div><em style={{ color: m.color }}>{m.tris} tris</em></div></button>)}</div>
          <aside className="model-detail"><span className="side-label">SELECTED ASSET</span><h2>{selected.name}</h2><div className="detail-mesh"><ModelViewer source={viewerSource(selected)} onError={reportViewerError} /></div><div className="spec-row"><span>三角面<b>{selected.tris}</b></span><span>顶点<b>{selected.verts}</b></span><span>{selected.local ? "UV覆盖" : "贴图"}<b>{selected.texture}</b></span></div>{selected.audit && <div className="audit-strip"><span>四边面 <b>{Math.round(selected.audit.quadRatio * 100)}%</b></span><span>边界边 <b>{selected.audit.boundaryEdges}</b></span><span>非流形 <b>{selected.audit.nonManifoldEdges}</b></span><span>N-gon <b>{selected.audit.ngonCount}</b></span></div>}<h3>绑定与拓扑维度</h3>{selected.quality.map((q, i) => <div className="quality-row" key={labels[i]}><span>{labels[i]}</span><i><b style={{ width: `${q}%`, background: selected.color }} /></i><em>{q}</em></div>)}<button className="primary full" onClick={() => { setScores(selected.quality); navigate("evaluate"); }}>评测此模型 →</button></aside>
        </div>
      </section>}

      {tab === "evaluate" && <section className="workspace-section">
        <div className="page-title"><div><span className="index">QUALITY SCORE / RIG-READY REVIEW</span><h1>模型质量评分</h1><p>用统一权重检查变形边流、关节环线和绑定适配；分数可由专家结合动作测试复核。</p></div><div className="status-pill"><i /> 自动保存</div></div>
        <div className="evaluation-layout"><div className="viewer-panel"><div className="viewer-toolbar"><span>{selected.name}.OBJ</span><div>{["实体", "线框", "法线"].map(v => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v}</button>)}</div></div><div className={`eval-mesh view-${view}`}><ModelViewer source={viewerSource(selected)} mode={view === "线框" ? "wireframe" : view === "法线" ? "normal" : "solid"} onError={reportViewerError} /></div><div className="viewer-stats"><span>TRIS <b>{selected.tris}</b></span><span>VERTS <b>{selected.verts}</b></span><span>RIG CHECK <b>READY</b></span></div></div>
          <div className="score-panel"><div className="score-summary"><ScoreRing score={total} /><div><span>当前综合评分</span><h2>{total >= 90 ? "优秀，可进入交付" : total >= 80 ? "良好，建议小幅优化" : "存在风险，需要返修"}</h2><p>权重加总，满分 100</p></div></div>{standards.map((s, i) => <div className="slider-row" key={s.name}><div><b>{s.name}</b><span>权重 {s.weight}%</span></div><output>{scores[i]}</output><input aria-label={`${s.name}评分`} type="range" min="0" max="100" value={scores[i]} onChange={e => setScores(scores.map((n, j) => j === i ? Number(e.target.value) : n))} /><small>{scores[i] >= 90 ? "达到交付标准" : scores[i] >= 80 ? "建议优化" : "重点风险"}</small></div>)}<textarea aria-label="评审意见" defaultValue="整体轮廓清晰，肩肘环线满足变形需求。建议删除腰侧 2 组无效支撑线，并统一手部 UV 密度。" /><button className="primary full" onClick={() => notify(`评测已提交：${total} 分`)}>提交评测 · {total} 分</button></div>
        </div>
      </section>}

      {tab === "pk" && <section className="workspace-section pk-workspace">
        <div className="page-title"><div><span className="index">MODEL PK / REAL LOCAL COMPARISON</span><h1>模型 PK</h1><p>选择任意两个样例或本地 OBJ，以真实网格统计和同一套绑定标准完成并排对比。</p></div><div className="pk-actions"><button className="primary" onClick={() => uploadRef.current?.click()}>＋ 上传 OBJ 参赛</button><button className="ghost" onClick={() => { setLeftId(right.id); setRightId(left.id); notify("已交换 A / B 组选手"); }}>交换 A / B</button></div></div>
        <div className="pk-selectors"><label>A 组选手<select value={left.id} onChange={e => setLeftId(Number(e.target.value))}>{libraryModels.filter(m => m.id !== right.id).map(m => <option key={m.id} value={m.id}>{m.local ? "[本地] " : ""}{m.name}</option>)}</select></label><div className="vs">VS</div><label>B 组选手<select value={right.id} onChange={e => setRightId(Number(e.target.value))}>{libraryModels.filter(m => m.id !== left.id).map(m => <option key={m.id} value={m.id}>{m.local ? "[本地] " : ""}{m.name}</option>)}</select></label></div>
        <div className="pk-stage"><article style={{ "--model-color": left.color } as React.CSSProperties}><div className="pk-label">MODEL A · {left.local ? "LOCAL OBJ" : "SAMPLE"}</div><ModelViewer source={viewerSource(left)} /><h2>{left.name}</h2>{left.audit && <div className="pk-audit">QUADS {Math.round(left.audit.quadRatio * 100)}% · BOUNDARY {left.audit.boundaryEdges} · NON-MANIFOLD {left.audit.nonManifoldEdges}</div>}<div className="pk-specs"><span>{left.tris}<small>TRIS</small></span><span>{left.verts}<small>VERTS</small></span><ScoreRing score={left.score} small /></div></article><div className="pk-divider"><span>VS</span></div><article style={{ "--model-color": right.color } as React.CSSProperties}><div className="pk-label">MODEL B · {right.local ? "LOCAL OBJ" : "SAMPLE"}</div><ModelViewer source={viewerSource(right)} /><h2>{right.name}</h2>{right.audit && <div className="pk-audit">QUADS {Math.round(right.audit.quadRatio * 100)}% · BOUNDARY {right.audit.boundaryEdges} · NON-MANIFOLD {right.audit.nonManifoldEdges}</div>}<div className="pk-specs"><span>{right.tris}<small>TRIS</small></span><span>{right.verts}<small>VERTS</small></span><ScoreRing score={right.score} small /></div></article></div>
        <div className="comparison-card"><div className="card-title"><div><span>维度对比</span><b>相同权重 · 标准化分数</b></div><strong className={left.score >= right.score ? "left-win" : "right-win"}>{left.score >= right.score ? "A" : "B"} 组领先 {Math.abs(left.score - right.score)} 分</strong></div><div className="compare-grid">{labels.map((label, i) => { const max = Math.max(left.quality[i], right.quality[i]); return <div className="compare-row" key={label}><b>{left.quality[i]}</b><div className="compare-left"><i style={{ width: `${left.quality[i]}%`, opacity: left.quality[i] === max ? 1 : .48 }} /></div><span>{label}</span><div className="compare-right"><i style={{ width: `${right.quality[i]}%`, opacity: right.quality[i] === max ? 1 : .48 }} /></div><b>{right.quality[i]}</b></div>})}</div></div>
        <div className="decision"><div className="decision-icon">AI</div><div><span>决策建议 · 基于本次评分</span><h3>优先选择 {left.score >= right.score ? left.name : right.name}</h3><p>{left.score >= right.score ? left.name : right.name} 在核心维度上的综合表现更稳定。若用于实时项目，预计可减少约 {Math.max(6, Math.abs(left.score-right.score)*2)}% 的拓扑返修时间；最终决定仍建议结合目标平台预算。</p></div><button className="primary" onClick={() => notify("PK 报告已生成（Demo）")}>生成 PK 报告</button></div>
      </section>}

      <footer><div className="brand"><span className="brandmark">T</span><span>TOPOLAB</span></div><p>AI 辅助判断，专家负责决策。Demo 数据仅用于产品演示。</p><span>VIBE CODING DEMO · 2026</span></footer>
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
