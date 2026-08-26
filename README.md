# Kekaku 计划

Kekaku 是一个以真实时间为中心的个人计划应用。前端使用 React + TypeScript，后端使用 Go；支持月、周、日视图、计划池、拖放排期、完成状态、自定义分类、布局设置，以及 DeepSeek 智能拆解和自动排期。

## 功能

- 月 / 周 / 日计划视图
- 拖动计划调整日期和时间
- 本周 / 本月计划池，支持拖入日历和拖回计划池
- DeepSeek 自然语言计划拆解与计划池自动排期
- 完成计划保留在日历并显示删除线
- 当前月 / 周 / 日的日历内容可导出为高清 JPG
- 当前视图计划可导出为兼容 iOS 日历导入的 ICS 文件
- 自定义分类名称和颜色
- 浅色主题、黑色主题、日历宽度、显示时段与每小时高度设置
- Go 服务端使用本地 SQLite 持久化，计划、计划池、分类和设置分别存表
- Go 服务端代理 DeepSeek API，浏览器端不接触 API Key

## 技术栈

- Web：React 19、TypeScript、Vite、Tailwind CSS、Lucide React、html-to-image
- API：Go 1.23、标准库 `net/http`
- 数据：SQLite（纯 Go 驱动），事务写入、外键约束、WAL 模式
- 部署：单个 Go 进程同时提供 API 和前端静态文件；包含 Dockerfile 与 Compose 配置

## 本地开发

要求 Node.js 22+、npm 10+ 和 Go 1.23+。

1. 安装前端依赖：

   ```bash
   npm install
   ```

2. 创建本地配置：

   ```bash
   cp .env.example .env
   ```

   Windows PowerShell：

   ```powershell
   Copy-Item .env.example .env
   ```

3. 在 `.env` 中填写 `DEEPSEEK_API_KEY`。密钥只由 Go 服务读取，不要提交 `.env`。

4. 启动 Go API：

   ```bash
   npm run dev:api
   ```

5. 在另一个终端启动 React：

   ```bash
   npm run dev
   ```

6. 打开 `http://127.0.0.1:5173`。Vite 会把 `/api` 请求代理到 `http://127.0.0.1:8080`。

## 构建与运行

```bash
npm run build
go build -o ./kekaku ./backend/cmd/server
./kekaku
```

Go 服务默认监听 `:8080`，并从 `./dist` 提供前端文件。

首次启动会创建 `./data/kekaku.db`。如果目录中存在旧版
`./data/kekaku.json`，服务会自动把数据迁移进空的 SQLite 数据库；旧 JSON
不会删除，可继续作为迁移备份。迁移完成后，后续读写只使用 SQLite。

SQLite 中包含以下业务表：

- `plans`：月、周、日计划和完成状态
- `pool_items`：本周、本月计划池事项
- `categories`：用户分类及颜色
- `app_settings`：主题、日历宽度、显示时段和小时高度
- `schema_migrations`：数据库结构版本

## Docker

```bash
docker compose up --build
```

打开 `http://localhost:8080`。应用数据保存在 `kekaku-data` volume 中。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | Go 服务端口 |
| `DATABASE_PATH` | `./data/kekaku.db` | SQLite 数据库文件 |
| `LEGACY_DATA_FILE` | `./data/kekaku.json` | 首次启动时可导入的旧 JSON 文件 |
| `STATIC_DIR` | `./dist` | React 构建产物目录 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 使用的模型 |
| `CORS_ORIGIN` | 空 | 额外允许的前端 Origin |
| `VITE_API_BASE_URL` | 空 | 前端 API 地址；同源部署保持为空 |

## 检查

```bash
npm run lint
npm test
npm run build
```

## 当前边界

当前版本定位为单用户计划应用，不包含账户系统和多人协作。若暴露到公网，建议在反向代理层增加身份认证；需要多人协作时可进一步迁移到 PostgreSQL。
