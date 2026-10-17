# 协议抓包检查工具

`core/scripts/inspect-protocol-capture.js` 用于检查 QQ 农场 WebSocket 抓包，支持浏览器导出的 HAR 文件和保存网关帧的 `.bin` 目录。

```bash
cd core
npm run inspect:protocol -- /完整路径/capture.har --pretty
npm run inspect:protocol -- /完整路径/frames --method Operate --audit --pretty
```

常用选项：

- `--service`、`--method`、`--direction`：过滤消息。
- `--shape`：只观察 protobuf 字段编号、wire type、出现次数和字节长度。
- `--audit`：检查未知字段、wire type、通知类型和 RPC 类型；存在问题时返回非零状态。
- `--decrypt-requests`：用仓库内 TSDK WASM 解密请求 body。默认不解密请求，也不会把加密内容误当 protobuf。
- `--show-sensitive`：显示已知敏感字段。默认对 token、code、cookie、session、metadata 等字段脱敏。

默认输出为 JSON Lines，消息写到标准输出，汇总和问题写到标准错误；`--pretty` 会输出单个格式化 JSON 对象。

抓包仍可能在未知 protobuf 数字字段中包含 GID 等数据。分享或提交输出前必须人工复核；不要对不可信抓包使用 `--show-sensitive`。
