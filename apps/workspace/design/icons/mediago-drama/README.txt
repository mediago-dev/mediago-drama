MediaGo Drama — 应用图标套件
================================
品牌色：浅色主题 #4D89FF / 深色主题 #3E74E0
设计：四宫格几何色块 + 圆角播放三角

目录
----
svg/         矢量源（1024 画布，可无限缩放）
png-dark/    深色版 PNG，16/32/48/64/128/256/512/1024
png-light/   浅色版 PNG，同尺寸
tauri/       直接用于 Tauri 的文件（取自深色版）

Tauri 用法
---------
推荐：npm run tauri icon png-dark/icon-dark-1024.png
手动：把 tauri/ 文件放进 src-tauri/icons/，在 tauri.conf.json 的 bundle.icon 引用
