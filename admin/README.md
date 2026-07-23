# U-Know 运营后台

第一版包含管理员登录、学校管理、帖子审核/下架和操作审计日志。

## 本地启动

```bash
cd admin
cp api/.env.example api/.env
# 填写 CloudBase 服务端凭证和至少 32 位 JWT_SECRET
npm install
npm run dev:api
npm run dev:web
```

浏览器访问 `http://127.0.0.1:5173`。首次启动时，API 会使用
`BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD` 创建唯一的超级管理员；
创建成功后必须从 `.env` 删除 `BOOTSTRAP_ADMIN_PASSWORD`。

## 私有服务器测试

服务器仅绑定 `127.0.0.1:8080`，用 SSH 隧道访问：

```bash
ssh -L 8080:127.0.0.1:8080 uknow-admin
```

然后打开 `http://127.0.0.1:8080`。

部署到 `/opt/uknow-admin` 后：

```bash
cd /opt/uknow-admin
cp api/.env.example api/.env
chmod 600 api/.env
# 编辑 api/.env 后再启动
docker compose up -d --build
docker compose ps
docker compose logs -f
```

## CloudBase 最小权限

为后台建立专用 CAM 子账号，仅授予当前 CloudBase 环境所需的数据库和云存储读取权限；
学校、帖子、管理员和审计日志集合需要写权限。不要将腾讯云主账号密钥或凭证提交到仓库。

## 正式上线前

- 备案完成后配置 `admin.<你的域名>` 和 HTTPS。
- 通过 Nginx 将公网 HTTPS 请求反代到 `127.0.0.1:8080`。
- 管理员账号必须使用强密码；增加管理员账号只能由超级管理员完成。
- 定期审查 `admin_audit_logs`，并禁止普通运营人员查看私聊正文。
