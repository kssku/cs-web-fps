# cs-web-fps — 浏览器里的 CS 风格 FPS

Three.js + 原生 ES 模块写的第一人称射击原型。没有打包器、没有游戏引擎，起一个静态服务器就能玩。

## 能玩到什么

- Three.js 渲染的第一人称射击
- AI 敌人：巡逻 / 追击 / 开火的状态机
- 后坐力、换弹、枪口火焰
- 小地图、计分板
- 回合制：暂停、被击杀、回合胜利

## 跑起来

```bash
npm install
npm start        # node server.mjs [port]
```

> 为什么需要一个服务器：`index.html` 用 importmap 加载 ES 模块，`file://` 下会被 CORS 拦掉，
> 所以配了个零依赖的 `server.mjs`，只做静态文件 + 正确的 MIME 类型。

## 模块

| 文件 | 职责 |
|---|---|
| `main.js` | 主循环、输入、回合状态机 |
| `map.js` | 场景、碰撞体、出生点 |
| `player.js` | 玩家控制器 |
| `enemy.js` | AI 敌人 |
| `weapons.js` | 武器与射击反馈 |
| `hud.js` | 血条、准星、击杀提示 |
| `server.mjs` | 零依赖静态服务器 |

## 状态

2026-09-18 一次提交完成的单人原型：单页拆成七个 ES 模块，可玩，未做联网对战。
运行时依赖只有 `three`。
