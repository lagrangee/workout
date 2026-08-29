# Design system

## 1. Overview

**Creative North Star: "安静的训练工作台"**

Workout Tracker 的界面应该像一个在训练间隙仍然安静可靠的工作台：信息被整理到手边，主要动作一眼可见，状态不会藏在装饰里。它服务于 Athlete 当下的执行，也为训练结束后的历史和趋势保留清楚、可修正的记录边界。

整体采用克制的产品型视觉语言：纸张般的浅色内容面、柔和陶土橙的行动色、恢复绿的完成状态，以及单一 sans-serif 字体系统。层次来自留白、细边界和轻柔的环境抬升，而不是游戏化徽章、排行榜、强刺激动效或过多装饰。

**Key Characteristics:**

- 安静、专注的训练执行面
- 清晰的大号数字和明确的状态反馈
- 柔和陶土橙只承担行动和选择
- 恢复绿承担完成、恢复和积极状态
- 移动端优先、触控区域宽松、内容不被固定底栏遮挡

## 2. Colors

颜色是柔和陶土橙、恢复绿和纸张中性色的 restrained palette。浅色背景降低训练时的视觉负担，主色只出现在需要 Athlete 做决定或确认的地方。

### Primary

- **柔和陶土橙** (#d65d3f): 主要行动按钮、进度线、当前选择和训练执行中的关键提示。
- **深陶土橙** (#a8432c): 主色的 hover、文字型行动和需要更高对比度的行动标签。

### Tertiary

- **恢复绿** (#477a5d): 已完成、恢复、正向状态和实际记录确认；不用于普通装饰。

### Neutral

- **墨色** (#26231f): 标题、正文和主要控件文字。
- **静音灰** (#787168): 辅助说明、元数据、未激活导航和次要状态。
- **纸张底色** (#f6f1e8): Today、登录和普通产品页面的背景。
- **内容卡片** (#fffdf8): 内容卡片、执行面和固定底栏的浅色表面。
- **细线** (#e6ddd0): 卡片边界、分隔线和输入框边界。

状态表面使用现有的低饱和 tint：完成和恢复使用 #e8f0e8，计划内容使用 #fbf7f0，错误提示使用 #fbe8e1。它们只承载语义，不成为新的品牌色。

### Named Rules

**The Restrained Accent Rule.** 陶土橙只用于行动、选择、进度和需要注意的状态；不把主色铺满背景，也不把颜色当作装饰。

## 3. Typography

**Display Font:** Inter with ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont and PingFang SC fallbacks
**Body Font:** Inter with the same system and Chinese fallbacks
**Label/Mono Font:** UI labels keep the same sans-serif; long JSON and technical textareas use the existing ui-monospace stack.

**Character:** 单一 sans-serif 系统让训练时的阅读保持熟悉、直接和稳定。数字需要清楚，倒计时、训练时长和完成比例使用 tabular numerals when available；中文 fallback 必须保持正常字重和可读行距。

### Hierarchy

- **Display** (700, clamp(32px, 9vw, 54px), 1.02): Today、登录和页面主标题；保持清楚的顶部层级，不用于重复的小区块标题。
- **Headline** (700, 42px or a compact 23–30px execution heading, 1.1): 当前 focus item、重要执行标题和休息倒计时的上下文。
- **Title** (700, 22px, 1.2): 页面分区、卡片标题和训练模块标题。
- **Body** (400, 16px, 1.6): 说明文字和主要内容；长文本保持约 65–75ch 的可读宽度。
- **Label** (720, 12px, 1.3): 按钮、状态标签、元数据和操作提示；小号 uppercase eyebrow 只用于少量页面标识，不要重复堆叠。

### Named Rules

**The One Sans Rule.** 不为单个新页面引入第二套相似 sans-serif；通过字重、尺寸和间距表达层级，保留产品的熟悉感。

## 4. Elevation

系统使用混合层次：细边界先定义结构，内容卡片再用柔和的环境阴影与背景色分离。当前主要卡片阴影为 0 18px 45px rgba(74, 52, 30, .08)，固定底栏使用半透明内容表面和 15px backdrop blur。阴影应保持安静，只帮助识别表面和浮层，不制造装饰性玻璃效果。

### Shadow Vocabulary

- **content-ambient** (0 18px 45px rgba(74, 52, 30, .08)): Today plan、focus card、calendar detail 和 summary card 的环境抬升。
- **selected-state** (0 8px 20px rgba(214, 93, 63, .12)): 日历选中或 hover 状态的短暂强调。
- **subtle-control** (0 3px 9px rgba(38, 35, 31, .08)): 已选 tab 等小型控件状态。

### Named Rules

**The Quiet Lift Rule.** 表面默认依靠色调和细线分层；只有已有的内容卡片、选中状态和固定底栏使用阴影或 blur，新增组件不叠加更重的装饰性层次。

## 5. Components

### Buttons

- **Shape:** 14px radius for primary, secondary, ghost and text actions; pill shapes are reserved for statuses.
- **Primary:** #d65d3f background, white text, 13px 18px padding, weight 720. Wide primary actions are used for the main Today and focus completion path.
- **Hover / Focus:** hover deepens to #a8432c. Focus-visible must remain visibly distinct without moving the layout; disabled state lowers emphasis and prevents duplicate actions.
- **Secondary / Ghost / Tertiary:** secondary is transparent with a 1px #e6ddd0 border and ink text; ghost is transparent muted text; text actions use deep terracotta without a filled surface.
- **Touch:** navigation controls keep at least 44px height; the focus completion action uses at least 48px.

### Status Pills and Progress

- **Style:** status pills use 7px 10px padding, 999px radius, low-saturation background and semantic text color.
- **State:** green indicates completed or recovery, muted tan indicates rest or neutral, deep terracotta indicates skipped or attention. Progress lines use a 6px track with the accent fill.

### Cards / Containers

- **Corner Style:** 18px for compact panels and 24px for established content cards; bottom sheets use a 28px top radius.
- **Background:** #fffdf8 card surface over #f6f1e8 page surface; execution mode may use the card surface as the full viewport.
- **Shadow Strategy:** use the content-ambient shadow only for established content cards; borders remain #e6ddd0.
- **Internal Padding:** 16px for compact panels, 18–20px for content cards, and 22px horizontal page gutters on mobile.

### Inputs / Fields

- **Style:** white surface, 1px #e6ddd0 border, 12px radius and 12px padding. Text uses ink; helper text uses muted.
- **Focus:** preserve a visible browser or design-system focus treatment; do not rely on color change alone.
- **Error / Disabled:** error surfaces use #fbe8e1 with #8e3626 text; disabled controls keep layout space while lowering emphasis and blocking duplicate commands.

### Navigation

- **Style:** the default product navigation is a fixed bottom bar with four equal columns, #fffdf8 translucent surface, top divider and 44px minimum tap height. The active item uses deep terracotta and weight 800; inactive items use muted.
- **Execution mode:** an active Workout Session replaces the global navigation with a compact session header, progress disclosure and fixed session footer so the Athlete can focus on one Completion Item.
- **Responsive behavior:** mobile is the primary composition. Calendar content collapses from seven columns to stacked rows at 520px; main content gains wider gutters at 650px.

### Focus Execution Surface

The focus surface is the signature component: one Completion Item owns the active session view. It uses a compact progress label, a clear exercise heading, a prescription line, actual-value panel, feedback field and one wide primary action. Rest uses the same session shell but changes the emphasis to a centered timer and the next-item context. Future timed execution should deepen this surface rather than introduce a parallel visual language.

## 6. Do's and Don'ts

### Do:

- Do use the existing accent, neutral and semantic status tokens before adding a new color.
- Do keep the main action obvious, wide and reachable on a phone; preserve 44px navigation targets and 48px focus actions.
- Do make timer values, actual values and completion states legible without requiring audio.
- Do use pending, disabled, error, paused and resumed states that retain the existing button, card, notice and spacing vocabulary.
- Do preserve the quiet relationship between Training Plan Snapshot, Workout Session and Actual Training Data in both copy and visual hierarchy.

### Don't:

- Don't make this an over-gamified, noisy fitness app that relies on badges or leaderboards.
- Don't add a second visual language for timed actions, audio controls or Wake Lock; extend the focus execution surface.
- Don't use decorative gradients, default glassmorphism, colored side-stripe borders or oversized shadow-plus-border treatments on new components.
- Don't tighten display letter-spacing beyond -0.04em or let large headings overflow a mobile viewport.
- Don't make sound the only way to understand a timer, status, error or saved result.
