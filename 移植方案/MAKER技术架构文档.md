3D 体素风平台跳跃游戏 — UrhoX (星火编辑器) 完整技术架构文档
用途：在外部 Agent Code 环境开发，确保所有技术细节与 UrhoX 引擎完全对齐，移植零摩擦。

1. 引擎约束总览
项目	约束
语言	Lua 5.4（支持位运算 & | ~ << >>）
长度单位	米（重力 -9.81 m/s²，角色高 1.8m，跳跃 8 m/s）
坐标系	Y-up 左手系（同 Unity）。Y=上, Z=前, X=右
数组索引	从 1 开始（for i = 1, n do）
代码目录	scripts/
资源目录	assets/
UI 系统	urhox-libs/UI（Yoga Flexbox + NanoVG），原生 UI 已废弃
物理引擎	Bullet（3D）
渲染	PBR（IBL + SH 球谐）
分辨率	graphics:SetMode() 已禁用，用 GetWidth()/GetHeight()/GetDPR()
2. 项目文件结构
/workspace/
├── scripts/
│   ├── main.lua                    -- 入口文件（Start() 函数）
│   ├── config/
│   │   └── GameConfig.lua          -- 全局配置常量
│   ├── world/
│   │   ├── World.lua               -- 世界数据存储
│   │   ├── ChunkMeshBuilder.lua    -- 区块网格生成
│   │   ├── TerrainGenerator.lua    -- 地形生成（噪声）
│   │   └── BlockRegistry.lua       -- 方块类型注册
│   ├── player/
│   │   ├── PlayerController.lua    -- 玩家输入与物理
│   │   └── Player.lua              -- 玩家状态
│   ├── gameplay/
│   │   ├── PlatformManager.lua     -- 平台生成与管理
│   │   ├── CollectibleSystem.lua   -- 收集物系统
│   │   └── LevelManager.lua        -- 关卡管理
│   └── ui/
│       └── GameUI.lua              -- HUD 与菜单
├── assets/
│   ├── Textures/
│   │   └── atlas.png               -- 纹理图集
│   └── Sounds/
│       └── jump.ogg
└── .project/
    └── settings.json               -- 引擎构建配置
3. 入口文件模板 (main.lua)
lua

复制
-- main.lua - 基于 scaffold-3d-character.lua 脚手架
require "LuaScripts/Utilities/Sample"
require "LuaScripts/Utilities/Touch"
require "urhox-libs.UI.GameHUD"
require "urhox-libs.Camera.ThirdPersonCamera"
local UI = require("urhox-libs/UI")

-- 全局变量
---@type Scene
local scene_ = nil
---@type ThirdPersonCameraInstance
local tpCamera_ = nil
---@type CharacterComponent
local character_ = nil

local CONFIG = {
    CharacterStartPos = Vector3(0, 10, 0),
    AirControlFactor = 0.4,  -- 马里奥风格
    EnableWalkMode = false,   -- 默认跑步
}

function Start()
    SampleStart()
    SampleInitMouseMode(MM_RELATIVE)  -- 隐藏鼠标 + 相对移动

    CreateScene()
    CreateCharacter()
    CreateGameHUD()
    SubscribeToEvents()
end

function Stop()
    UI.Shutdown()
end
4. 场景创建与光照
lua

复制
function CreateScene()
    scene_ = Scene:new()
    scene_:CreateComponent("Octree")
    scene_:CreateComponent("PhysicsWorld")
    scene_:CreateComponent("DebugRenderer")

    -- 第三人称相机
    tpCamera_ = ThirdPersonCamera.Create(scene_, {
        modes = {
            normal = { distance = 8.0, offset = Vector3(0, 2.0, 0), fov = 50.0 },
        },
        transitionSpeed = 8.0,
        farClip = 300.0,
    })
    renderer:SetViewport(0, Viewport:new(scene_, tpCamera_:GetCamera()))

    -- 加载光照预设（已包含 Zone + DirectionalLight）
    local lightGroupFile = cache:GetResource("XMLFile", "LightGroup/Daytime.xml")
    local lightGroup = scene_:CreateChild("LightGroup")
    lightGroup:LoadXML(lightGroupFile:GetRoot())

    -- ⚠️ 不要再手动创建 Zone！LightGroup 已包含完整 Zone（priority=-1）
    -- 如需调整雾效：
    -- local zone = lightGroup:GetComponent("Zone", true)
    -- zone.fogStart = 100
    -- zone.fogEnd = 300
end
LightGroup 可用预设：

文件	说明
LightGroup/Daytime.xml	白天（推荐默认）
LightGroup/Dusk.xml	黄昏
LightGroup/Night.xml	夜晚
LightGroup/DarkNight.xml	暗夜
5. 角色物理 — 三组件模式 🔴 核心
UrhoX 明确禁止 Dynamic RigidBody + SetLinearVelocity 控制 3D 角色（会导致"墙壁粘滞"）。

必须使用 RigidBody + KinematicCharacterController + CharacterComponent 三组件模式：

lua

复制
function CreateCharacter()
    local characterNode = scene_:CreateChild("Player")
    characterNode.position = CONFIG.CharacterStartPos

    -- 模型节点（此处可替换为体素角色模型）
    local modelNode = characterNode:CreateChild("ModelNode")
    local model = modelNode:CreateComponent("StaticModel")
    model:SetModel(cache:GetResource("Model", "Models/Box.mdl"))
    model:SetMaterial(cache:GetResource("Material", "Materials/Stone.xml"))
    modelNode.scale = Vector3(0.7, 1.8, 0.7)
    modelNode.position = Vector3(0, 0.9, 0)  -- 模型中心偏移

    -- ═══════════════════════════════════════════════════
    -- 组件 1: RigidBody（禁用自身移动，仅用于碰撞事件）
    -- ═══════════════════════════════════════════════════
    local body = characterNode:CreateComponent("RigidBody")
    body:SetCollisionLayerAndMask(2, 1)  -- layer=角色, mask=地面
    body:SetMass(1)
    body:SetLinearFactor(Vector3.ZERO)   -- 🔴 关键：RigidBody 不移动
    body:SetAngularFactor(Vector3.ZERO)
    body:SetCollisionEventMode(COLLISION_ALWAYS)

    -- ═══════════════════════════════════════════════════
    -- 组件 2: CollisionShape（胶囊碰撞体）
    -- ═══════════════════════════════════════════════════
    local shape = characterNode:CreateComponent("CollisionShape")
    shape:SetCapsule(0.7, 1.8, Vector3(0.0, 0.86, 0.0))

    -- ═══════════════════════════════════════════════════
    -- 组件 3: KinematicCharacterController（实际控制移动）
    -- ═══════════════════════════════════════════════════
    local kinematicController = characterNode:CreateComponent("KinematicCharacterController")
    kinematicController:SetCollisionLayerAndMask(4, 1)  -- 独立碰撞层
    kinematicController.jumpSpeed = 8.0    -- 属性风格 ✅
    -- kinematicController:SetJumpSpeed(8.0)  -- 方法风格也 ✅
    kinematicController.maxSlope = 50.0
    kinematicController.stepHeight = 0.4
    kinematicController.gravity = Vector3(0, -20, 0)

    -- ═══════════════════════════════════════════════════
    -- 组件 4: CharacterComponent（高层封装：空中控制、旋转等）
    -- ═══════════════════════════════════════════════════
    character_ = characterNode:CreateComponent("CharacterComponent")
    character_:SetAirControlFactor(CONFIG.AirControlFactor)
    character_:SetEnableWalkMode(CONFIG.EnableWalkMode)
end
三组件职责分离：

组件	职责
RigidBody	碰撞事件检测（LinearFactor=ZERO 禁用移动）
KinematicCharacterController	实际控制角色移动、跳跃、台阶爬升、重力
CharacterComponent	高层封装：输入→移动映射、空中控制、旋转、状态查询
6. 输入处理 — controls 对象模式
CharacterComponent 通过 controls 对象接收输入，不是直接操控速度：

lua

复制
function HandleUpdate(eventType, eventData)
    if character_ == nil then return end

    -- ⚠️ GameHUD 自动处理：CTRL_JUMP、CTRL_RUN、摇杆移动、触摸视角
    -- PC 端只需处理鼠标视角

    if not touchEnabled then
        character_.controls.yaw = character_.controls.yaw + input.mouseMoveX * YAW_SENSITIVITY
        character_.controls.pitch = character_.controls.pitch + input.mouseMoveY * YAW_SENSITIVITY
    end

    -- 限制俯仰角
    character_.controls.pitch = Clamp(character_.controls.pitch, -80.0, 80.0)

    -- 角色自动面向移动方向（平台跳跃游戏推荐）
    character_.autoRotateToMoveDir = true
end
PC 端键盘输入（如果不使用 GameHUD，需手动设置）：

lua

复制
character_.controls:Set(CTRL_FORWARD, input:GetKeyDown(KEY_W))
character_.controls:Set(CTRL_BACK, input:GetKeyDown(KEY_S))
character_.controls:Set(CTRL_LEFT, input:GetKeyDown(KEY_A))
character_.controls:Set(CTRL_RIGHT, input:GetKeyDown(KEY_D))
character_.controls:Set(CTRL_JUMP, input:GetKeyDown(KEY_SPACE))
character_.controls:Set(CTRL_RUN, input:GetKeyDown(KEY_SHIFT))
7. GameHUD — 移动端 HUD 一体化
lua

复制
function CreateGameHUD()
    -- 步骤 1: 初始化
    GameHUD.Initialize()

    -- 步骤 2: 绑定 controls 对象（自动映射摇杆→角色移动）
    GameHUD.SetControls(character_.controls)

    -- 步骤 3: 创建 HUD 界面
    GameHUD.Create({
        enableJump = true,      -- 跳跃按钮
        enableRun = true,       -- 跑步按钮
    })

    -- 步骤 4: 启用触摸视角控制
    GameHUD.EnableTouchLook({
        camera = tpCamera_:GetNode(),
    })
end
GameHUD 自动处理：

摇杆 → CTRL_FORWARD/BACK/LEFT/RIGHT
跳跃按钮 → CTRL_JUMP
跑步按钮 → CTRL_RUN
空白区域滑动 → controls.yaw/pitch
8. 第三人称相机
lua

复制
-- PostUpdate 中更新相机（必须在这里，不是 Update）
function HandlePostUpdate(eventType, eventData)
    if character_ == nil then return end
    local timeStep = eventData["TimeStep"]:GetFloat()

    local characterNode = character_:GetNode()
    tpCamera_:Update(timeStep, characterNode, character_.controls.yaw, character_.controls.pitch)
end
ThirdPersonCamera API：

方法	说明
ThirdPersonCamera.Create(scene, config)	创建实例
tpCamera_:Update(dt, node, yaw, pitch)	每帧更新（PostUpdate 中调用）
tpCamera_:SetMode(name)	切换模式
tpCamera_:GetCamera()	获取 Camera 组件
tpCamera_:GetNode()	获取相机节点
内置墙壁碰撞检测，无需手动处理穿墙。

9. 体素世界数据存储
lua

复制
-- World.lua
local World = {}
World.__index = World

function World.new()
    local self = setmetatable({}, World)
    -- 区块数据（数字键，高频访问优化）
    self.chunkData = {}  -- key: chunkX * 65536 + chunkZ
    -- 区块渲染节点（字符串键，低频访问）
    self.chunkNodes = {} -- key: "chunkX,chunkZ"
    return self
end

-- 方块索引公式：y * 256 + localZ * 16 + localX
-- (CHUNK_SIZE = 16, WORLD_HEIGHT = 128)
function World:getBlock(bx, by, bz)
    local chunkX = math.floor(bx / 16)
    local chunkZ = math.floor(bz / 16)
    local localX = bx - chunkX * 16
    local localZ = bz - chunkZ * 16

    local numericKey = chunkX * 65536 + chunkZ
    local chunkData = self.chunkData[numericKey]
    if not chunkData then return 0 end  -- AIR

    local idx = by * 256 + localZ * 16 + localX
    return chunkData.blocks[idx] or 0
end

function World:setBlock(bx, by, bz, blockType)
    local chunkX = math.floor(bx / 16)
    local chunkZ = math.floor(bz / 16)
    local localX = bx - chunkX * 16
    local localZ = bz - chunkZ * 16

    local numericKey = chunkX * 65536 + chunkZ
    local chunkData = self.chunkData[numericKey]
    if not chunkData then
        chunkData = { blocks = {}, minY = by, maxY = by }
        self.chunkData[numericKey] = chunkData
    end

    local idx = by * 256 + localZ * 16 + localX
    chunkData.blocks[idx] = blockType

    -- 更新高度范围
    if by < chunkData.minY then chunkData.minY = by end
    if by > chunkData.maxY then chunkData.maxY = by end
end
10. 区块网格生成 (CustomGeometry)
lua

复制
function ChunkMeshBuilder:buildChunk(chunkX, chunkZ)
    local chunkNode = scene_:CreateChild("Chunk_" .. chunkX .. "," .. chunkZ)

    -- 创建 CustomGeometry
    local geometry = chunkNode:CreateComponent("CustomGeometry")
    geometry:BeginGeometry(0, TRIANGLE_LIST)

    local startX = chunkX * CHUNK_SIZE
    local startZ = chunkZ * CHUNK_SIZE
    local vertexCount = 0

    for lx = 0, CHUNK_SIZE - 1 do
        for lz = 0, CHUNK_SIZE - 1 do
            for y = minY, maxY do
                local idx = y * 256 + lz * 16 + lx
                local blockType = blocks[idx] or AIR
                if blockType ~= AIR then
                    -- 对6个面进行邻居检查（面剔除优化）
                    for _, face in ipairs(CUBE_FACES) do
                        local nx = lx + face.check[1]
                        local ny = y + face.check[2]
                        local nz = lz + face.check[3]
                        local neighbor = self:getNeighborBlock(chunkX, chunkZ, nx, ny, nz)

                        -- 仅当邻居是空气/水/透明时才渲染该面
                        if neighbor == AIR or neighbor == WATER then
                            for _, vert in ipairs(face.vertices) do
                                geometry:DefineVertex(Vector3(
                                    (startX + lx + vert.pos[1]) * BLOCK_SIZE,
                                    (y + vert.pos[2]) * BLOCK_SIZE,
                                    (startZ + lz + vert.pos[3]) * BLOCK_SIZE
                                ))
                                geometry:DefineNormal(face.normal)
                                geometry:DefineTexCoord(Vector2(vert.uv[1], vert.uv[2]))
                                geometry:DefineColor(COLOR_WHITE)
                                vertexCount = vertexCount + 1
                            end
                        end
                    end
                end
            end
        end
    end

    geometry:Commit()

    -- 设置材质
    if vertexCount > 0 then
        geometry:SetMaterial(0, self:getChunkMaterial())
    end
end
关键点：

每个面 6 个顶点（2 个三角形，TRIANGLE_LIST）
DefineVertex → DefineNormal → DefineTexCoord → DefineColor 顺序
面剔除：只渲染邻居是透明方块的面
调用 Commit() 后 GPU 才更新
11. 体素碰撞检测 — 两种方案
方案 A：自定义 AABB 碰撞（Minecraft 示例使用此方案）
不依赖 Bullet 物理，纯 Lua 数学计算：

lua

复制
-- 分轴检测（X → Z → Y 顺序）
function PlayerController:applyMovement(moveDir, timeStep)
    local pos = player:getPosition()
    local velocity = player:getVelocity()
    local radius = 0.3  -- 玩家碰撞半径（米）

    -- X轴碰撞
    local newX = pos.x + moveDir.x * speed * timeStep
    if not self:checkCollisionX(newX, pos.y, pos.z, radius) then
        pos.x = newX
    end

    -- Z轴碰撞
    local newZ = pos.z + moveDir.z * speed * timeStep
    if not self:checkCollisionZ(pos.x, pos.y, newZ, radius) then
        pos.z = newZ
    end

    -- Y轴碰撞（重力/跳跃）
    velocity.y = velocity.y + GRAVITY * timeStep
    local newY = pos.y + velocity.y * timeStep
    if velocity.y <= 0 then
        -- 检测脚下方块
        local blockY = math.floor(newY / BLOCK_SIZE)
        if world:isSolid(math.floor(pos.x / BLOCK_SIZE), blockY, math.floor(pos.z / BLOCK_SIZE)) then
            pos.y = (blockY + 1) * BLOCK_SIZE
            velocity.y = 0
            player.onGround = true
        else
            pos.y = newY
            player.onGround = false
        end
    else
        -- 上方碰撞（头顶）
        pos.y = newY
    end

    player:setPosition(pos)
    player:setVelocity(velocity)
end
方案 B：Bullet 三角形网格碰撞（适合需要物理交互的场景）
lua

复制
-- 为 chunk 的 CustomGeometry 创建 Bullet 碰撞体
local body = chunkNode:CreateComponent("RigidBody")
-- mass=0 → 静态刚体
body.collisionLayer = 1  -- 地面层

local shape = chunkNode:CreateComponent("CollisionShape")
shape:SetCustomTriangleMesh(geometry)  -- 直接传入 CustomGeometry
方案对比：

方案 A（自定义 AABB）	方案 B（Bullet TriangleMesh）
性能	更快（无 Bullet 开销）	chunk 多时较重
精度	轴对齐（体素天然适合）	任意形状
物理交互	无（需自行实现）	有（刚体/关节）
推荐场景	纯平台跳跃	需要物理掉落/爆炸
12. 碰撞事件系统（Bullet 物理专用）
lua

复制
-- 碰撞事件表
-- NodeCollision      → 每帧触发（持续接触）
-- NodeCollisionStart → 碰撞开始（一次性）
-- NodeCollisionEnd   → 碰撞结束

-- 节点级订阅（推荐）
SubscribeToEvent(playerNode, "NodeCollisionStart", "HandleCollisionStart")

function HandleCollisionStart(eventType, eventData)
    local otherNode = eventData["OtherNode"]:GetPtr("Node")
    local otherBody = eventData["OtherBody"]:GetPtr("RigidBody")
    local isTrigger = eventData["Trigger"]:GetBool()

    -- ⚠️ 必须按顺序读取全部 4 个字段！（否则数据错位）
    local contacts = eventData["Contacts"]:GetBuffer()
    while not contacts.eof do
        local position = contacts:ReadVector3()  -- 1. 位置
        local normal   = contacts:ReadVector3()  -- 2. 法线
        local distance = contacts:ReadFloat()    -- 3. 距离
        local impulse  = contacts:ReadFloat()    -- 4. 冲量
        
        -- 地面检测：法线 Y > 0.75 表示从上方碰撞
        if normal.y > 0.75 then
            isOnGround = true
        end
    end
end
触发器设置：

lua

复制
-- 创建触发器（收集物品、区域检测等）
local triggerBody = node:CreateComponent("RigidBody")
triggerBody.trigger = true  -- 🔴 关键：标记为触发器
triggerBody.collisionLayer = 4
triggerBody.collisionMask = 2  -- 只与玩家碰撞

local triggerShape = node:CreateComponent("CollisionShape")
triggerShape:SetSphere(1.0)
注意：body.collisionEventMode = COLLISION_ALWAYS 让静止物体也能触发碰撞事件。

13. 材质系统
程序化纯色材质（体素方块）
lua

复制
function CreateVoxelMaterial(color)
    local mat = Material:new()
    mat:SetTechnique(0, cache:GetResource("Technique", "Techniques/PBR/PBRNoTexture.xml"))
    mat:SetShaderParameter("MatDiffColor", Variant(color))
    mat:SetShaderParameter("Roughness", Variant(0.8))
    mat:SetShaderParameter("Metallic", Variant(0.0))
    return mat
end

-- 透明材质（水面）
function CreateWaterMaterial()
    local mat = Material:new()
    mat:SetTechnique(0, cache:GetResource("Technique", "Techniques/PBR/PBRNoTextureAlpha.xml"))
    mat:SetShaderParameter("MatDiffColor", Variant(Color(0.2, 0.5, 0.9, 0.6)))
    mat:SetShaderParameter("Roughness", Variant(0.1))
    mat:SetShaderParameter("Metallic", Variant(0.0))
    return mat
end
纹理图集材质（带贴图）
lua

复制
function CreateAtlasMaterial(texturePath)
    local mat = Material:new()
    -- 带顶点颜色的 PBR
    mat:SetTechnique(0, cache:GetResource("Technique", "Techniques/PBR/PBRMetallicRoughDiffNormalSpecVCol.xml"))
    mat:SetTexture(TU_DIFFUSE, cache:GetResource("Texture2D", texturePath))
    mat:SetShaderParameter("MatDiffColor", Variant(Color(1, 1, 1, 1)))
    mat:SetShaderParameter("Roughness", Variant(0.8))
    mat:SetShaderParameter("Metallic", Variant(0.0))
    return mat
end
可用 Technique 路径（程序化材质只用这些）：

Techniques/PBR/PBRNoTexture.xml — 不透明 PBR
Techniques/PBR/PBRNoTextureAlpha.xml — 透明 PBR
Techniques/NoTextureUnlit.xml — 无光照
Techniques/DiffVCol.xml — 带顶点颜色（非 PBR）
14. 音频系统
lua

复制
-- 播放一次性 3D 音效
function PlaySound3D(position, soundPath)
    local node = scene_:CreateChild("Sound")
    node.position = position

    local source = node:CreateComponent("SoundSource3D")
    source.nearDistance = 1.0
    source.farDistance = 20.0
    source.autoRemoveMode = REMOVE_NODE  -- 播放完自动删除节点

    local sound = cache:GetResource("Sound", soundPath)
    source:Play(sound)
end

-- 播放 2D 音效（UI 反馈等，不受位置影响）
function PlaySound2D(soundPath)
    local node = scene_:CreateChild("Sound2D")
    local source = node:CreateComponent("SoundSource")
    source.autoRemoveMode = REMOVE_NODE
    source.soundType = "Effect"

    local sound = cache:GetResource("Sound", soundPath)
    source:Play(sound)
end

-- 背景音乐（循环）
function PlayBGM(soundPath)
    local node = scene_:CreateChild("BGM")
    local source = node:CreateComponent("SoundSource")
    source.soundType = "Music"
    
    local sound = cache:GetResource("Sound", soundPath)
    sound.looped = true
    source:Play(sound)
end
15. UI 系统 (urhox-libs/UI)
lua

复制
local UI = require("urhox-libs/UI")

function CreateUI()
    UI.Init({
        fonts = {
            { family = "sans", weights = { normal = "Fonts/MiSans-Regular.ttf" } }
        },
        scale = UI.Scale.DEFAULT,
    })

    -- 保留引用方便后续更新
    local scoreLabel = UI.Label { id = "score", text = "分数: 0", fontSize = 16, fontColor = {255,255,255} }
    local healthLabel = UI.Label { id = "health", text = "生命: 100", fontSize = 16, fontColor = {255,100,100} }

    local root = UI.Panel {
        width = "100%", height = "100%",
        pointerEvents = "box-none",
        children = {
            UI.Panel {
                position = "absolute", top = 10, left = 10,
                children = { scoreLabel, healthLabel }
            }
        }
    }
    UI.SetRoot(root)

    -- 后续更新用 FindById 或直接引用
    scoreLabel:SetText("分数: 100")
    -- 或: root:FindById("score"):SetText("分数: 100")
end
16. 本地存档
lua

复制
local cjson = require("cjson")

-- 保存
function SaveGame(data)
    local file = File("save.json", FILE_WRITE)
    if file:IsOpen() then
        file:WriteString(cjson.encode(data))
        file:Close()
    end
end

-- 加载
function LoadGame()
    if not fileSystem:FileExists("save.json") then return nil end
    
    local file = File("save.json", FILE_READ)
    if not file:IsOpen() then return nil end
    
    local ok, data = pcall(cjson.decode, file:ReadString())
    file:Close()
    return ok and data or nil
end
注意：

路径是相对的，引擎自动按项目+用户隔离
WASM 平台刷新页面存档丢失，需持久化用 clientCloud
io 库不可用，只能用 File
17. 事件订阅
lua

复制
function SubscribeToEvents()
    SubscribeToEvent("Update", "HandleUpdate")
    SubscribeToEvent("PostUpdate", "HandlePostUpdate")
    -- 如果只用 Update，取消 SceneUpdate 避免冲突
    UnsubscribeFromEvent("SceneUpdate")
end
18. 平台跳跃特有功能
移动平台
lua

复制
-- 方案1: 使用 ScriptObject（参考脚手架）
MovingPlatform = ScriptObject()

function MovingPlatform:Start()
    self.startPos = Vector3(0, 5, 0)
    self.endPos = Vector3(10, 5, 0)
    self.speed = 3.0
    self.t = 0
end

function MovingPlatform:FixedUpdate(timeStep)
    self.t = self.t + timeStep * self.speed * 0.1
    local t = (math.sin(self.t) + 1) * 0.5  -- 0~1 来回
    self.node.position = self.startPos:Lerp(self.endPos, t)
end

-- 方案2: 标记为移动平台（KinematicCharacterController 会自动跟随）
platformNode:SetVar(StringHash("IsMovingPlatform"), true)
收集物品（使用触发器）
lua

复制
function CreateCollectible(position)
    local node = scene_:CreateChild("Coin")
    node.position = position

    local model = node:CreateComponent("StaticModel")
    model:SetModel(cache:GetResource("Model", "Models/Sphere.mdl"))
    model:SetMaterial(CreateVoxelMaterial(Color(1, 0.8, 0)))
    node.scale = Vector3(0.3, 0.3, 0.3)

    local body = node:CreateComponent("RigidBody")
    body.trigger = true
    body.collisionLayer = 4
    body.collisionMask = 2

    local shape = node:CreateComponent("CollisionShape")
    shape:SetSphere(0.3)

    -- 订阅碰撞开始事件（一次性）
    SubscribeToEvent(node, "NodeCollisionStart", "HandleCoinCollected")
end

function HandleCoinCollected(eventType, eventData)
    local node = eventData["Node"]:GetPtr("Node")
    node:Remove()  -- 删除金币节点
    score = score + 1
end
19. 性能优化要点
优化	做法
面剔除	只渲染邻居为空气的面
高度范围	只遍历 minY~maxY
本地化热路径变量	local floor = math.floor
分帧加载	每帧只构建 1-2 个 chunk
UV 缓存	材质包加载后预计算所有方块的 UV
视距剔除	超出视距的 chunk 不渲染
LOD	远处 chunk 用更低分辨率网格
20. 模型尺寸速查
模型	尺寸 (BoundingBox.size)
Models/Box.mdl	1.0 × 1.0 × 1.0
Models/Sphere.mdl	直径 1.0
Models/Cylinder.mdl	直径 1.0, 高 1.0
Models/Cone.mdl	直径 1.0, 高 1.0
Models/Plane.mdl	1.0 × 0.002 × 1.0
Models/Torus.mdl	查 built-in-models.md
地板定位公式：node.position.y = -size.y / 2（放在 Y=0 地面上）

21. 枚举值速查
lua

复制
-- 鼠标按钮
MOUSEB_LEFT, MOUSEB_MIDDLE, MOUSEB_RIGHT

-- 鼠标模式
MM_ABSOLUTE, MM_RELATIVE, MM_FREE

-- 常用按键
KEY_W, KEY_A, KEY_S, KEY_D, KEY_SPACE, KEY_SHIFT, KEY_ESCAPE, KEY_F

-- 刚体类型（通过 mass 决定）
-- mass = 0 → 静态
-- mass > 0 → 动态
-- body.kinematic = true → 运动学

-- 碰撞事件模式
COLLISION_NEVER, COLLISION_ACTIVE, COLLISION_ALWAYS

-- 自动删除模式
REMOVE_DISABLED, REMOVE_COMPONENT, REMOVE_NODE

-- 角色控制
CTRL_FORWARD, CTRL_BACK, CTRL_LEFT, CTRL_RIGHT, CTRL_JUMP, CTRL_RUN
22. CharacterComponent API 速查
属性/方法	类型	说明
controls	Controls	输入对象（yaw, pitch, buttons）
autoRotateToMoveDir	bool	自动面向移动方向
rotationSpeed	number	旋转速度 (°/s)
airControlFactor	number	空中控制 (0~1)
walkSpeed / runSpeed	number	步行/跑步速度
enableWalkMode	bool	true=默认步行,Shift跑
IsOnGround()	→ bool	是否着地
IsJumping()	→ bool	是否跳跃中
IsJumpStarted()	→ bool	起跳帧（用于触发跳跃动画）
GetMoveSpeed()	→ number	当前移动速度
IsMoving()	→ bool	是否在移动
空中控制参考值：

0.05 = Fall Guys 风格（几乎无法控制）
0.2 = Roblox 风格
0.4 = 马里奥风格（推荐平台跳跃）
0.6 = 默认值
1.0 = 完全控制
23. KinematicCharacterController API 速查
属性	类型	说明
jumpSpeed	number	跳跃速度
fallSpeed	number	最大下落速度
maxSlope	number	最大爬坡角度 (°)
stepHeight	number	台阶高度 (m)
gravity	Vector3	重力向量
linearDamping	number	线性阻尼
方法	说明
SetCollisionLayerAndMask(layer, mask)	碰撞过滤
OnGround()	是否着地
Jump(vec3?)	跳跃
Warp(position)	传送到位置
SetWalkDirection(dir)	设置行走方向
GetLinearVelocity()	获取当前速度
24. 完整事件订阅清单
lua

复制
SubscribeToEvent("Update", "HandleUpdate")           -- 每帧（输入处理）
SubscribeToEvent("PostUpdate", "HandlePostUpdate")   -- 帧后（相机更新）

-- 碰撞事件（选其一）
SubscribeToEvent(node, "NodeCollisionStart", "...")   -- 节点级（推荐）
SubscribeToEvent("PhysicsCollisionStart", "...")      -- 全局级
25. 移植检查清单
[ ] scripts/main.lua 包含 Start() 函数
[ ] 使用三组件模式创建角色（RigidBody + KinematicCharacterController + CharacterComponent）
[ ] 不要 直接设置 RigidBody.linearVelocity 移动角色
[ ] GameHUD 初始化顺序：Initialize → SetControls → Create → EnableTouchLook
[ ] LightGroup 路径正确："LightGroup/Daytime.xml"（无 ‘s’）
[ ] File 用法：File("save.json", FILE_WRITE) — 无 :new()
[ ] 数组索引从 1 开始
[ ] 枚举值使用常量名（MOUSEB_LEFT 而非 0）
[ ] 调用 MCP build 工具构建