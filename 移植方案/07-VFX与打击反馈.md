# 07 — VFX 与打击反馈

## 概述

原游戏的"juice"（打击感）系统是核心体验的关键组成部分。包含：

1. **命中停顿** (Hit Stop) — 时间缩放
2. **方向性相机冲击** (Directional Impulse)
3. **屏幕抖动** (Screen Shake)
4. **粒子爆发** (Particle Burst)
5. **屏幕闪白** (Screen Flash)
6. **色差/径向扭曲** (后处理 — MAKER 中有限实现)

---

## 原始 VFX 参数

```javascript
// vfx.js + init-combat.js
hitStop: 2-4 frames (33-66ms) 时间冻结
impulse: direction * 0.3 相机位移
shake: intensity 0.1~2.0
flash: color white, duration 0.05~0.2s, opacity 0.3~1.0
chromatic: intensity 0~5 (对应色差强度)
timescale: 0.01 (charge), 0.1 (hit), 2.0 (release)
```

---

## 实现：Juice.lua

```lua
-- scripts/vfx/Juice.lua
local Config = require("scripts/config")

local Juice = {}

local camera_ = nil  -- FPSCamera 模块引用

-- 时间缩放
local timeScale_ = 1.0
local timeScaleTarget_ = 1.0
local timeScaleDuration_ = 0
local timeScaleTimer_ = 0

-- 命中停顿
local hitStopTimer_ = 0
local hitStopDuration_ = 0

-- 屏幕闪白
local flashNode_ = nil
local flashTimer_ = 0
local flashDuration_ = 0
local flashOpacity_ = 0

function Juice.Init(fpsCamera)
    camera_ = fpsCamera
end

function Juice.Update(dt)
    -- 命中停顿：返回实际 dt（乘以时间缩放）
    if hitStopTimer_ > 0 then
        hitStopTimer_ = hitStopTimer_ - dt
        -- 在停顿期间，游戏逻辑时间 = 0
        return 0
    end

    -- 时间缩放平滑过渡
    if timeScaleTimer_ > 0 then
        timeScaleTimer_ = timeScaleTimer_ - dt
        if timeScaleTimer_ <= 0 then
            timeScale_ = 1.0
        end
    end

    -- 闪白衰减
    if flashTimer_ > 0 then
        flashTimer_ = flashTimer_ - dt
        if flashTimer_ <= 0 then
            Juice._hideFlash()
        end
    end

    return dt * timeScale_
end

--- 获取经过时间缩放的 dt（主循环使用此值）
function Juice.GetScaledDt(rawDt)
    if hitStopTimer_ > 0 then
        hitStopTimer_ = hitStopTimer_ - rawDt
        return 0.0001  -- 近乎冻结但不完全为0
    end

    if timeScaleTimer_ > 0 then
        timeScaleTimer_ = timeScaleTimer_ - rawDt
        if timeScaleTimer_ <= 0 then
            timeScale_ = 1.0
        end
        return rawDt * timeScale_
    end

    return rawDt
end

-- === 效果触发 ===

--- 命中停顿（时间冻结 N 帧）
---@param frames number 冻结帧数 (2~4 推荐)
function Juice.HitStop(frames)
    hitStopDuration_ = frames / 60.0  -- 60fps 基准
    hitStopTimer_ = hitStopDuration_
end

--- 时间缩放
---@param scale number 缩放系数 (0.01 = 几乎停止, 2.0 = 加速)
---@param duration number 持续时间（秒）
function Juice.SetTimeScale(scale, duration)
    timeScale_ = scale
    timeScaleTimer_ = duration
end

--- 方向性相机冲击
---@param direction Vector3 冲击方向（世界空间）
---@param force number 力度 (0.1~1.0)
function Juice.Impulse(direction, force)
    if camera_ then
        camera_.Impulse(direction, force)
    end
end

--- 屏幕抖动
---@param intensity number 强度 (0.1~2.0)
function Juice.Shake(intensity)
    if camera_ then
        camera_.Shake(intensity)
    end
end

--- 屏幕闪白
---@param duration number 持续时间（秒）
---@param opacity number 不透明度 (0~1)
function Juice.Flash(duration, opacity)
    flashTimer_ = duration
    flashDuration_ = duration
    flashOpacity_ = opacity or 1.0
    Juice._showFlash()
end

--- FOV 偏移（冲刺/释放时拉宽）
function Juice.FOVKick(offset, duration)
    if camera_ then
        camera_.SetFOVOffset(offset)
        -- duration 秒后恢复（通过时间缩放计时器）
        -- 简化：在 Update 中检查并恢复
    end
end

-- === 组合效果（便捷调用） ===

--- 环境命中反馈（弹射物撞墙）
function Juice.OnEnvironmentHit(position, normal)
    Juice.Shake(0.1)
    Juice.SpawnDebris(position, normal, 5, Config.COLOR_WHITE)
end

--- 敌人命中反馈
function Juice.OnEnemyHit(position, normal, damage)
    Juice.HitStop(2)
    Juice.Impulse(normal * -1, 0.2)
    Juice.Shake(0.3)
    Juice.SpawnDebris(position, normal, 10, Config.COLOR_CYAN)

    if damage >= 10 then
        Juice.Flash(0.05, 0.3)
    end
end

--- 敌人击杀反馈
function Juice.OnEnemyKill(position)
    Juice.HitStop(4)
    Juice.Shake(1.0)
    Juice.Flash(0.1, 0.5)
    Juice.SpawnDebris(position, Vector3(0, 1, 0), 20, Config.COLOR_CYAN)
end

--- 大招释放反馈
function Juice.OnUltimateRelease()
    Juice.SetTimeScale(2.0, 0.3)
    Juice.Shake(2.0)
    Juice.Flash(0.15, 0.8)
    Juice.FOVKick(15, 0.5)
end

--- 蓄力中反馈
function Juice.OnCharging(progress)
    -- 蓄力时减速时间
    Juice.SetTimeScale(0.3 + 0.7 * (1.0 - progress), 0.1)
    -- 轻微持续抖动
    Juice.Shake(0.05 * progress)
end

-- === 粒子系统 ===

--- 生成碎片粒子
---@param position Vector3 生成位置
---@param normal Vector3 碰撞面法线（粒子飞出方向）
---@param count number 粒子数量
---@param color Color 粒子颜色
function Juice.SpawnDebris(position, normal, count, color)
    local scene = camera_ and camera_.GetCameraNode():GetScene() or nil
    if not scene then return end

    for i = 1, count do
        local node = scene:CreateChild("Debris")
        node.position = position

        -- 随机偏移初始位置
        node.position = node.position + Vector3(
            (math.random() - 0.5) * 0.5,
            (math.random() - 0.5) * 0.5,
            (math.random() - 0.5) * 0.5
        )

        -- 随机大小
        local s = 0.05 + math.random() * 0.1
        node.scale = Vector3(s, s, s)

        -- 模型
        local model = node:CreateComponent("StaticModel")
        model:SetModel(cache:GetResource("Model", "Models/Box.mdl"))
        local mat = Material:new()
        mat:SetTechnique(0, cache:GetResource("Technique", "Techniques/NoTextureUnlit.xml"))
        mat:SetShaderParameter("MatDiffColor", Variant(color))
        model:SetMaterial(mat)

        -- 速度（沿法线方向 + 随机扩散）
        local speed = 5 + math.random() * 10
        local dir = Vector3(
            normal.x + (math.random() - 0.5) * 1.5,
            normal.y + math.random() * 0.5,
            normal.z + (math.random() - 0.5) * 1.5
        ):Normalized()

        -- 存储物理数据（用于 DebrisUpdate）
        node:SetVar(StringHash("vx"), Variant(dir.x * speed))
        node:SetVar(StringHash("vy"), Variant(dir.y * speed))
        node:SetVar(StringHash("vz"), Variant(dir.z * speed))
        node:SetVar(StringHash("life"), Variant(0.8 + math.random() * 0.5))
        node:SetVar(StringHash("age"), Variant(0.0))
        node:SetVar(StringHash("spinX"), Variant((math.random() - 0.5) * 720))
        node:SetVar(StringHash("spinY"), Variant((math.random() - 0.5) * 720))
    end
end

-- === 碎片粒子更新（在主循环中调用） ===

function Juice.UpdateDebris(dt, scene)
    local toRemove = {}
    local children = scene:GetChildren(false)

    for i = 0, children:Size() - 1 do
        local node = children:At(i)
        if node.name == "Debris" or node.name == "DeathDebris" then
            local age = node:GetVar(StringHash("age")):GetFloat()
            local life = node:GetVar(StringHash("life")):GetFloat()
            age = age + dt

            if age >= life then
                toRemove[#toRemove + 1] = node
            else
                -- 物理更新
                local vx = node:GetVar(StringHash("vx")):GetFloat()
                local vy = node:GetVar(StringHash("vy")):GetFloat()
                local vz = node:GetVar(StringHash("vz")):GetFloat()

                -- 重力
                vy = vy - 30 * dt

                -- 位移
                node.position = node.position + Vector3(vx * dt, vy * dt, vz * dt)

                -- 旋转
                local spinX = node:GetVar(StringHash("spinX")):GetFloat()
                local spinY = node:GetVar(StringHash("spinY")):GetFloat()
                local rot = node.rotation:EulerAngles()
                node.rotation = Quaternion(rot.x + spinX * dt, rot.y + spinY * dt, 0)

                -- 缩放衰减
                local progress = age / life
                local scale = (1.0 - progress) * node.scale.x
                if scale > 0.001 then
                    node.scale = Vector3(scale, scale, scale)
                end

                -- 写回
                node:SetVar(StringHash("vy"), Variant(vy))
                node:SetVar(StringHash("age"), Variant(age))
            end
        end
    end

    -- 移除过期粒子
    for _, node in ipairs(toRemove) do
        node:Remove()
    end
end

-- === 闪白 UI 实现 ===

function Juice._showFlash()
    -- 使用 UI 层覆盖（NanoVG 白色矩形）
    -- 或使用场景中的全屏四边形
    -- 具体实现取决于 MAKER UI 系统能力
    -- 方案：创建一个近裁剪面的白色面片
    -- TODO: 使用 urhox-libs/UI 创建全屏白色面板
end

function Juice._hideFlash()
    -- 移除闪白 UI
end

return Juice
```

---

## 主循环集成

```lua
function HandleUpdate(eventType, eventData)
    local rawDt = eventData["TimeStep"]:GetFloat()

    -- 通过 Juice 获取缩放后的 dt
    local dt = Juice.GetScaledDt(rawDt)

    -- 所有游戏逻辑使用 dt（而非 rawDt）
    PlayerMovement.Update(dt, FPSCamera.GetYaw())
    PlayerPhysics.Update(dt)
    WeaponSystem.Update(dt)

    -- ProjectileSystem 返回命中结果
    local hitResults = ProjectileSystem.Update(dt)

    -- 处理命中反馈
    for _, hit in ipairs(hitResults) do
        if hit.type == "environment" then
            Juice.OnEnvironmentHit(hit.position, hit.normal)
        elseif hit.type == "enemy" then
            Juice.OnEnemyHit(hit.position, hit.normal, hit.damage)
            if hit.demon and hit.demon:IsDead() then
                Juice.OnEnemyKill(hit.position)
            end
        end
    end

    -- 粒子物理更新（用 rawDt，不受时间缩放影响）
    Juice.UpdateDebris(rawDt, scene_)

    -- VFX 内部更新
    Juice.Update(rawDt)
end
```

---

## MAKER 中的限制与替代方案

| 原始效果 | MAKER 可行性 | 替代方案 |
|----------|-------------|----------|
| Hit Stop (时间冻结) | **可实现** | dt 缩放为 0 |
| Screen Shake | **可实现** | 相机位置偏移 |
| Directional Impulse | **可实现** | 相机位置偏移 |
| Screen Flash | **可实现** | UI 白色面板 或 场景面片 |
| FOV Kick | **可实现** | camera.fov 动态修改 |
| Chromatic Aberration | **无法实现** | 省略（无后处理管线） |
| Radial Distortion | **无法实现** | 省略 |
| Vignette | **部分** | UI 四角暗色面板 |
| CRT Scanlines | **无法实现** | 省略 |
| Time Scale | **可实现** | dt 乘系数 |

---

## 冲击波效果

```lua
--- 冲击波环（从玩家位置向外扩展的圆环）
function Juice.SpawnShockwave(position, color)
    local scene = camera_.GetCameraNode():GetScene()
    local node = scene:CreateChild("Shockwave")
    node.position = position
    node.rotation = Quaternion(90, 0, 0)  -- 水平放置

    local model = node:CreateComponent("StaticModel")
    model:SetModel(cache:GetResource("Model", "Models/Torus.mdl"))
    node.scale = Vector3(0.1, 0.1, 0.1)

    local mat = Material:new()
    mat:SetTechnique(0, cache:GetResource("Technique", "Techniques/NoTextureUnlit.xml"))
    mat:SetShaderParameter("MatDiffColor", Variant(color or Config.COLOR_CYAN))
    model:SetMaterial(mat)

    -- 存储动画数据
    node:SetVar(StringHash("expandSpeed"), Variant(30.0))
    node:SetVar(StringHash("life"), Variant(0.5))
    node:SetVar(StringHash("age"), Variant(0.0))
end
```

---

## 效果强度参考表

| 事件 | HitStop | Shake | Impulse | Flash | 粒子数 |
|------|---------|-------|---------|-------|--------|
| 散射命中环境 | 0 | 0.1 | 0 | 0 | 5 |
| 散射命中敌人 | 2帧 | 0.3 | 0.2 | 0 | 10 |
| 连射命中 | 0 | 0.05 | 0.05 | 0 | 3 |
| 单针命中 | 3帧 | 0.5 | 0.3 | 0.3 | 15 |
| 大招释放 | 0 | 2.0 | 1.0 | 0.8 | 30 |
| 敌人死亡 | 4帧 | 1.0 | 0 | 0.5 | 20 |
| 气球弹跳 | 0 | 0.2 | 0 | 0 | 8 |
