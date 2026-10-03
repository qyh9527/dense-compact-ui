# 字体

默认用系统字体栈（`tokens.css` 的 `--dc-font-sans` / `--dc-font-mono`）：零下载，中文覆盖完整。用户指定品牌字体，或系统字体在目标平台确实不够用时，才读本文件。

## 选用

- 一个无衬线族承担全部文字，最多再加一个等宽族给 ID、哈希、代码；不为「显得高级」加衬线。
- 中文界面里，品牌字体通常只覆盖拉丁字母：拉丁字体放前、中文系统字体放后，如 `"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`。确需中文网络字体时选字重齐全的开源字体（思源黑体 / Noto Sans SC、HarmonyOS Sans、MiSans 等），先核对授权。
- 选支持 `tnum` 特性的字体，并确认 `font-variant-numeric: tabular-nums` 实际生效。
- 高密档优先 x 高度大、字形开阔的字体；窄体和细笔画在 13px 下难读。
- 字重只用 400 / 500 / 600，少加载文件。
- 常见搭配：Inter + JetBrains Mono、Geist + Geist Mono、IBM Plex Sans + IBM Plex Mono。

## 加载

- 自托管 WOFF2；拉丁字体按 `unicode-range` 分子集。中文字体按字频或 Unicode 区块切片，每页只下载用到的片；不直接引用几 MB 的整份中文字体。
- 每个 `@font-face` 都写 `font-display`：正文用 `optional`（不中途换字体、没有布局偏移）；品牌标题必须显示时用 `swap`，并配回退字体度量。
- 回退字体度量：用 `size-adjust`、`ascent-override`、`descent-override`、`line-gap-override` 让回退字体与网络字体占位一致，换字体时不跳动。
- 只预加载首屏用到的 1–2 个子集：`<link rel="preload" as="font" type="font/woff2" crossorigin>`；不预加载整族。
- 可变字体只在需要 3 个以上字重时用，同样要子集化。
- 面向中国大陆用户时不依赖 Google Fonts，自托管或用国内 CDN。
- `lang` 写对（`zh-CN`、`zh-TW`、`ja`），同一码位的中日韩字形不同。

## 检查

- 字体加载前后布局不跳（CLS < 0.1）。
- 首屏字体总量控制在约 150 KB 以内（已缓存的不算）。
- 字体加载失败时，回退字体下界面仍然正确、不出现方框字。
