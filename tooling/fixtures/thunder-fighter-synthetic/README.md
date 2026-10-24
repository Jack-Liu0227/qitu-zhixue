# 雷霆战机合成验收作品

本目录是线上演示学生八课时验收提交的合成作品，不是模型生成代码执行器，也不代表真实学生能力。

在可丢弃 Python 环境安装 `pygame==2.6.1`，运行 `python game.py`。方向键或 WASD 移动，空格发射，失败后 R 重开，Esc 或关闭窗口退出。素材均为本目录绘制的几何图形。

`--level 1` 对应第4课窗口与移动；`--level 2` 对应第5课子弹、敌机与清理；默认第3级对应第6至7课的得分、生命、失败与重开。源码使用浮点位置与时间步长，消除低速位移被整数截断的问题。

`python verify.py --level 3 --output <目录>` 会打开真实 Pygame 窗口，通过事件队列输入验证移动、边界、发射、命中、去重、失败、重开和退出，并保存截图与源码摘要。此测试不使用静态语法通过替代运行验证；不声明生产容器 runner 已接入。

实现依据：[事件队列](https://www.pygame.org/docs/ref/event.html)、[Rect 碰撞](https://www.pygame.org/docs/ref/rect.html)、[时钟](https://www.pygame.org/docs/ref/time.html)。
