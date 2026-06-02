import { toPng, toSvg } from "html-to-image";

import { pickExportSavePath, saveExportFile } from "../api/commands";

export type ExportFormat = "png" | "svg";

const BG_COLOR = "#ffffff";
const PIXEL_RATIO = 2;

export async function exportDiagram(
  format: ExportFormat,
  defaultName: string,
): Promise<string | null> {
  const reactFlow = document.querySelector<HTMLElement>(".react-flow");
  if (!reactFlow) {
    throw new Error("ER図のレンダリング要素が見つかりません。");
  }

  const rect = reactFlow.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const path = await pickExportSavePath(defaultName, format);
  if (path == null) return null;

  const skipSelectors = [
    ".react-flow__controls",
    ".react-flow__minimap",
    ".react-flow__attribution",
    ".react-flow__panel",
  ];
  const filter = (node: HTMLElement) => {
    if (!(node instanceof Element)) return true;
    return !skipSelectors.some((sel) => node.matches(sel));
  };

  const dataUrl =
    format === "png"
      ? await toPng(reactFlow, {
          backgroundColor: BG_COLOR,
          width,
          height,
          pixelRatio: PIXEL_RATIO,
          cacheBust: true,
          filter,
        })
      : await toSvg(reactFlow, {
          backgroundColor: BG_COLOR,
          width,
          height,
          cacheBust: true,
          filter,
        });

  await saveExportFile(path, dataUrlToBytes(dataUrl));
  return path;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("html-to-image returned an invalid data URL.");
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (header.includes(";base64")) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}
