import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TopoLab · AI 3D 拓扑低模评测",
  description: "可解释、可对比、可追踪的 AI 3D 拓扑低模质量评测工具。",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "TopoLab · AI 3D 拓扑低模评测",
    description: "让每一个面，都有据可评。",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "TopoLab AI 3D 拓扑低模评测" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
