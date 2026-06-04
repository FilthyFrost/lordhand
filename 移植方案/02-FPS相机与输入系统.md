# 02 — FPS 相机与输入系统

## 概述

原游戏使用 Three.js `PerspectiveCamera` 直接附加在玩家位置，通过 Pointer Lock API 获取鼠标相对移动。MAKER 不内置 FPS 相机，需完全自实现。

---

## 原始实现分析

```javascript
// game-core.js 中的相机设置
camera = new THREE.PerspectiveCamera(90, w/h, 0.1, 1000);
camera.position.copy(player.pos);
camera.position.y += 1.6; // 眼睛高度

// 鼠标控制
document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
        player.yaw -= e.movementX * 0.002;
        player.pitch -= e.movementY * 0.002;
        player.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, player.pitch));
    }
});

// 每帧更新相机方向
camera.rotation.order = 'YXZ';
camera.rotation.y = player.yaw;
camera.rotation.x = player.pitch;
```

---

## MAKER 实现：FPSCamera.lua

```lua
-- scripts/camera/FPSCamera.lua
local Config = require("scripts/config")

local FPSCamera = {}

local cameraNode_ = nil   -- 相机节点
local camera_ = nil        -- Camera 组件
local playerNode_ = nil    -- 跟随的玩家节点

local yaw_ = 0.0          -- 水平旋转（度）
local pitch_ = 0.0         -- 垂直旋转（度）

-- 相机抖动状态
local shakeOffset_ = Vector3.ZERO
local shakeIntensity_ = 0.0
local shakeDecay_ = 8.0

-- 相机冲击（方向性）
local impulseOffset_ = Vector3.ZERO
local impulseDecay_ = 12.0

-- FOV 动态偏移
local fovOffset_ = 0.0
local fovTarget_ = 0.0
local fovLerpSpeed_ = 8.0

function FPSCamera.Init(scene, playerNode)
    playerNode_ = playerNode

    -- 创建相机节点（不附加到玩家，独立更新位置）
    cameraNode_ = scene:CreateChild("FPSCamera")
    camera_ = cameraNode_:CreateComponent("Camera")
    camera_.fov = Config.FOV_DEFAULT
    camera_.nearClip = 0.1
    camera_.farClip = 500.0

    -- 设置视口
    renderer:SetViewport(0, Viewport:new(scene, camera_))
end

function FPSCamera.UpdateInput(dt)
    -- 鼠标相对移动（MM_RELATIVE 模式下自动隐藏鼠标）
    local mouseX = input.mouseMoveX
    local mouseY = input.mouseMoveY

    yaw_ = yaw_ - mouseX * Config.MOUSE_SENSITIVITY
    pitch_ = pitch_ - mouseY * Config.MOUSE_SENSITIVITY
    pitch_ = Clamp(pitch_, Config.PITCH_MIN, Config.PITCH_MAX)

    -- FOV 平滑过渡
    local targetFov = Config.FOV_DEFAULT + fovOffset_
    camera_.fov = Lerp(camera_.fov, targetFov, fovLerpSpeed_ * dt)
end

function FPSCamera.PostUpdate(dt, playerPos)
    -- 基础位置 = 玩家位置 + 眼睛高度
    local basePos = Vector3(playerPos.x, playerPos.y + Config.PLAYER_EYE_HEIGHT, playerPos.z)

    -- 叠加抖动
    shakeIntensity_ = shakeIntensity_ * math.exp(-shakeDecay_ * dt)
    if shakeIntensity_ > 0.01 then
        shakeOffset_ = Vector3(
            (math.random() - 0.5) * 2 * shakeIntensity_,
            (math.random() - 0.5) * 2 * shakeIntensity_,
            (math.random() - 0.5) * 2 * shakeIntensity_
        )
    else
        shakeOffset_ = Vector3.ZERO
        shakeIntensity_ = 0
    end

    -- 叠加方向冲击
    impulseOffset_ = impulseOffset_ * math.exp(-impulseDecay_ * dt)

    -- 最终位置
    local finalPos = basePos + shakeOffset_ + impulseOffset_
    cameraNode_.position = finalPos

    -- 旋转：YXZ 顺序（先偏航再俯仰）
    cameraNode_.rotation = Quaternion(pitch_, yaw_, 0.0)
end

-- === 公共接口 ===

function FPSCamera.GetYaw()
    return yaw_
end

function FPSCamera.GetPitch()
    return pitch_
end

function FPSCamera.GetForward()
    -- 相机前方向量（考虑 yaw + pitch）
    local rad_yaw = math.rad(yaw_)
    local rad_pitch = math.rad(pitch_)
    return Vector3(
        math.sin(rad_yaw) * math.cos(rad_pitch),
        -math.sin(rad_pitch),
        math.cos(rad_yaw) * math.cos(rad_pitch)
    ):Normalized()
end

function FPSCamera.GetRight()
    local rad_yaw = math.rad(yaw_)
    return Vector3(math.cos(rad_yaw), 0, -math.sin(rad_yaw)):Normalized()
end

function FPSCamera.GetCameraNode()
    return cameraNode_
end

function FPSCamera.GetCamera()
    return camera_
end

-- === 效果触发 ===

--- 屏幕抖动
---@param intensity number 抖动强度（推荐 0.1~2.0）
function FPSCamera.Shake(intensity)
    shakeIntensity_ = math.max(shakeIntensity_, intensity)
end

--- 方向性冲击（命中时使用）
---@param direction Vector3 冲击方向（世界空间）
---@param force number 冲击力度
function FPSCamera.Impulse(direction, force)
    impulseOffset_ = impulseOffset_ + direction * force
end

--- FOV 偏移（冲刺时拉宽）
---@param offset number FOV 偏移量（度）
function FPSCamera.SetFOVOffset(offset)
    fovOffset_ = offset
end

return FPSCamera
```

---

## 输入系统集成

MAKER 中通过 `input` 全局对象读取输入状态：

```lua
-- 键盘状态查询（每帧在 Update 中调用）
local moveForward = input:GetKeyDown(KEY_W)
local moveBack = input:GetKeyDown(KEY_S)
local moveLeft = input:GetKeyDown(KEY_A)
local moveRight = input:GetKeyDown(KEY_D)
local jump = input:GetKeyPress(KEY_SPACE)       -- 单次触发
local dash = input:GetKeyPress(KEY_SHIFT)       -- 单次触发
local pause = input:GetKeyPress(KEY_ESCAPE)

-- 鼠标按钮
local lmbDown = input:GetMouseButtonDown(MOUSEB_LEFT)
local lmbPress = input:GetMouseButtonPress(MOUSEB_LEFT)   -- 按下瞬间
local lmbRelease = not input:GetMouseButtonDown(MOUSEB_LEFT)  -- 松开检测
local rmbDown = input:GetMouseButtonDown(MOUSEB_RIGHT)
local rmbPress = input:GetMouseButtonPress(MOUSEB_RIGHT)

-- 鼠标移动（MM_RELATIVE 模式）
local mouseDX = input.mouseMoveX  -- 像素偏移
local mouseDY = input.mouseMoveY
```

### 输入映射对照表

| 原始 (JavaScript) | MAKER (Lua) | 用途 |
|-------------------|-------------|------|
| `keys['w']` | `input:GetKeyDown(KEY_W)` | 前进 |
| `keys['s']` | `input:GetKeyDown(KEY_S)` | 后退 |
| `keys['a']` | `input:GetKeyDown(KEY_A)` | 左移 |
| `keys['d']` | `input:GetKeyDown(KEY_D)` | 右移 |
| `keys[' ']` pressed | `input:GetKeyPress(KEY_SPACE)` | 跳跃 |
| `keys['shift']` pressed | `input:GetKeyPress(KEY_SHIFT)` | 冲刺 |
| `e.movementX` | `input.mouseMoveX` | 鼠标水平 |
| `e.movementY` | `input.mouseMoveY` | 鼠标垂直 |
| `mousedown(0)` | `input:GetMouseButtonPress(MOUSEB_LEFT)` | LMB按下 |
| `mouseup(0)` | 检测 Down→!Down 变化 | LMB松开 |
| `mousedown(2)` | `input:GetMouseButtonPress(MOUSEB_RIGHT)` | RMB按下 |

### 鼠标松开检测

MAKER 没有直接的 "MouseButtonRelease" 事件，需用状态差分：

```lua
local prevLMB_ = false
local prevRMB_ = false

function DetectRelease()
    local lmbNow = input:GetMouseButtonDown(MOUSEB_LEFT)
    local rmbNow = input:GetMouseButtonDown(MOUSEB_RIGHT)

    local lmbReleased = prevLMB_ and not lmbNow
    local rmbReleased = prevRMB_ and not rmbNow

    prevLMB_ = lmbNow
    prevRMB_ = rmbNow

    return lmbReleased, rmbReleased
end
```

---

## 坐标系转换注意

Three.js 右手系：
- X = 右
- Y = 上
- Z = 向屏幕外（即 -Z 是前方）

MAKER 左手系：
- X = 右
- Y = 上
- Z = 前方

**转换规则**：Three.js 的 `forward = (sin(yaw), 0, -cos(yaw))` 在 MAKER 中变为 `forward = (sin(yaw), 0, cos(yaw))`（取消 Z 负号）。

上面的 `FPSCamera.GetForward()` 已经按照 MAKER 左手系编写。

---

## Quaternion 旋转说明

MAKER 的 `Quaternion(pitch, yaw, roll)` 构造函数接收欧拉角（度），内部转换顺序为 YXZ：
1. 先绕 Y 轴旋转 yaw
2. 再绕 X 轴旋转 pitch
3. 最后绕 Z 轴旋转 roll

这与原游戏 `camera.rotation.order = 'YXZ'` 一致。

---

## 移动端预留

当检测到触屏时，可以启用 GameHUD 右半区域的滑动来替代鼠标：

```lua
-- 未来移动端支持（当前 PC 不需要）
if touchEnabled then
    GameHUD.EnableTouchLook({
        camera = cameraNode_,
    })
end
```

当前阶段不实现，仅预留接口。
