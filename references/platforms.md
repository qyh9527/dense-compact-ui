# 原生与跨端平台

做 iOS / Android 原生、Tauri 移动端、React Native、Flutter，或 Electron / Tauri 桌面应用时读。网页规则照用，这里只写平台差异。平台规范与本技能冲突时以平台为准：用户熟悉的系统行为优先于紧凑。

## 共同

- 优先用系统控件：开关、选择器、日期、底部弹层自带无障碍、触感和系统动效，只改样式。
- 热区：iOS 44×44pt，Android 48×48dp，桌面鼠标 24px 起；按主指针判断，带触屏的笔记本用鼠标时仍按桌面算。
- 系统字号（iOS 动态字体、Android 字体缩放）调到最大时布局不坏：文字可换行，固定高度的行改为最小高度。
- 安全区：刘海、灵动岛、底部手势条、圆角屏；固定栏补 inset，滚动内容留出同样的位置。
- 深浅色默认跟随系统；应用内允许覆盖。
- 手机上的高密度靠去卡片、贴边分区、合并重复信息、按需展开，不靠缩小热区和字号。

## iOS

- 顶层导航用标签栏，放最常用的 3–5 个目的地，更多的收进「更多」；进入子页面时标签栏保持可见，沉浸式全屏任务除外。
- 返回：导航栏左上返回按钮 + 屏幕左缘右滑；不要用自定义手势占用左缘。
- 列表行的左滑操作要有可见的等效入口（更多菜单或详情页按钮）。
- 底部弹层可下拉关闭；有未保存改动时，下拉关闭前确认。

## Android

- 按窗口宽度选导航：紧凑宽度（手机竖屏）用底部导航栏，3–5 个目的地；中等宽度用侧边导航轨；展开宽度用导航轨或常驻抽屉。
- 返回：支持系统返回手势和预测性返回（Android 13 起可选、需在 manifest 打开 `android:enableOnBackInvokedCallback`，用 `OnBackPressedCallback` 处理）；不劫持返回去做无关的事。
- 顶部应用栏放标题和 1–3 个操作，其余进溢出菜单。
- 边到边显示：目标 SDK 35（Android 15）起强制，必须处理状态栏和导航栏 insets。
- 项目使用 Material 动态取色时以系统色为准，本技能只提供空间与密度规则。

## 桌面（含 Tauri、Electron）

- 鼠标为主，可用高密档。
- 快捷键按平台约定：macOS 用 ⌘，Windows / Linux 用 Ctrl；不占用系统保留键。
- 窗口缩到最小尺寸时仍可用；记住窗口大小和分栏比例。
- 自绘标题栏时保留拖拽区、窗口按钮、双击最大化等系统行为。

## 触感反馈

- 只给有意义的时刻：确认成功、失败或拒绝、开关切换、拖拽越过阈值或吸附、长按触发、滑动选择刻度。普通点击、滚动不加。
- 强度对应重要性；刻度、拖动这类高频事件必须很轻，或者干脆不做。
- 同一动作全应用用同一种触感；触感只是附加，视觉和文字反馈必须独立成立；尊重系统里关闭触感的设置。
- 用系统的语义接口，不手写振动时长：
  - iOS：`UISelectionFeedbackGenerator`（选择变化）、`UIImpactFeedbackGenerator`（碰撞、吸附）、`UINotificationFeedbackGenerator`（成功、警告、失败）；SwiftUI 用 `.sensoryFeedback`。
  - Android：`View.performHapticFeedback(HapticFeedbackConstants.CONFIRM / REJECT / TOGGLE_ON / SEGMENT_TICK / LONG_PRESS …)`，无需权限，自动遵循用户设置；不用 `Vibrator.vibrate(long)` 这类老式单次振动。
  - React Native：`expo-haptics` 等封装；Flutter：`HapticFeedback.selectionClick()` 等。
  - 网页：`navigator.vibrate` 在 iOS Safari 不可用、桌面无效果，只能作为增强，不承载任何信息。

## 检查

- 最大系统字号、横屏、带刘海和手势条的机型上，核心任务能完成。
- 返回手势、系统返回键行为符合平台预期，未保存内容不会因误触返回丢失。
- 触感在系统关闭触感后不再触发，关闭后功能不受影响。
