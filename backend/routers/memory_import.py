"""Memory import router — import host knowledge from external sources."""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.auth import get_current_user
from services.llm import chat_completion_json
from services.host_knowledge import (
    get_host_knowledge, save_host_knowledge, merge_host_knowledge,
)
from prompts.context import load_template

logger = logging.getLogger("memory_import")

router = APIRouter(prefix="/api/import", tags=["import"])

MAX_IMPORT_SIZE = 10000


@router.post("/memory")
async def import_memory(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    fmt = body.get("format", "text")
    data = body.get("data", "")
    strategy = body.get("merge_strategy", "append")

    if not data.strip():
        raise HTTPException(400, "数据不能为空")
    if len(data) > MAX_IMPORT_SIZE:
        raise HTTPException(400, f"数据过长，最多 {MAX_IMPORT_SIZE} 字符")
    if fmt not in ("json", "text", "conversation"):
        raise HTTPException(400, "format 必须是 json/text/conversation")

    extracted = {}

    if fmt == "json":
        try:
            extracted = json.loads(data)
            if not isinstance(extracted, dict):
                raise HTTPException(400, "JSON 必须是对象格式")
        except json.JSONDecodeError as e:
            raise HTTPException(400, f"JSON 解析失败: {e}")

    elif fmt == "text":
        template = load_template("MEMORY_IMPORT.md")
        messages = [
            {"role": "system", "content": template},
            {"role": "user", "content": data},
        ]
        extracted = await chat_completion_json(messages)

    elif fmt == "conversation":
        template = load_template("MEMORY_IMPORT_CONV.md")
        messages = [
            {"role": "system", "content": template},
            {"role": "user", "content": data},
        ]
        extracted = await chat_completion_json(messages)

    if not extracted:
        return {"ok": False, "imported_fields": [], "summary": "未能提取有效信息"}

    existing = await get_host_knowledge(db, user.shrimp_id)

    if strategy == "replace":
        merged = extracted
    else:
        merged = merge_host_knowledge(existing, extracted)

    await save_host_knowledge(db, user.shrimp_id, merged)

    fields = [k for k, v in extracted.items() if v]
    logger.info(f"Memory imported for {user.shrimp_id}: format={fmt}, fields={fields}")

    return {
        "ok": True,
        "imported_fields": fields,
        "summary": f"成功导入 {len(fields)} 个维度的信息",
    }


@router.get("/guide")
async def import_guide(request: Request):
    """返回导入说明，供用户的本地 AI 代理阅读后自动调用 API 导入记忆。"""
    host = request.headers.get("host", request.base_url.hostname)
    scheme = request.url.scheme
    base_url = f"{scheme}://{host}"
    return {"guide": _build_guide(base_url)}


def _build_guide(base_url: str) -> str:
    return f"""# ClawChat 记忆导入 API 说明

你正在帮助用户将记忆导入到 ClawChat（虾聊）平台。请按照以下步骤操作。

## 第一步：登录获取 Token

```
POST {base_url}/api/auth/login
Content-Type: application/json

{{"username": "<用户告诉你的用户名>", "password": "<用户告诉你的密码>"}}
```

响应：
```json
{{"access_token": "eyJ...", "shrimp_id": "xxx"}}
```

## 第二步：导入记忆

```
POST {base_url}/api/import/memory
Authorization: Bearer <上一步获取的 access_token>
Content-Type: application/json
```

### 请求体格式

你需要把你了解的关于用户的所有信息，整理成以下 JSON 格式发送：

```json
{{
  "format": "json",
  "data": "<下面的 JSON 字符串>",
  "merge_strategy": "append"
}}
```

其中 `data` 字段是一个 **JSON 字符串**（需要转义），内容格式如下：

```json
{{
  "communication_style": "用户的说话风格，比如：说话直接、喜欢用反问、爱用省略号",
  "values": ["价值观1", "价值观2"],
  "habits": ["生活习惯1", "生活习惯2"],
  "preferences": {{
    "food": "最喜欢的食物",
    "music": "最喜欢的音乐/歌手",
    "movie": "最喜欢的电影",
    "game": "最喜欢的游戏",
    "其他类别": "具体偏好"
  }},
  "emotional_triggers": ["情绪敏感点"],
  "life_context": "职业、生活状态等背景信息",
  "social_preferences": "社交偏好，比如：不喜欢尬聊、喜欢深度交流",
  "quirks": ["口头禅xxx", "小习惯1"],
  "raw_facts": ["具体事实1", "具体事实2"]
}}
```

### 重要说明

- **只导入你确定知道的信息**，不确定的字段留空字符串或空数组
- `data` 字段的值必须是 **字符串**（JSON.stringify 后的结果）
- `merge_strategy: "append"` 会把新信息追加到已有信息上，不会覆盖
- 你也可以用 `"format": "text"` 直接发送自然语言描述，系统会自动提取

### 用自然语言导入（更简单）

如果整理 JSON 太麻烦，你可以直接用自然语言：

```json
{{
  "format": "text",
  "data": "用户是一个程序员，喜欢打游戏和看动漫，说话比较直接...",
  "merge_strategy": "append"
}}
```

## 第三步：确认导入成功

成功响应：
```json
{{"ok": true, "imported_fields": ["preferences", "habits", ...], "summary": "成功导入 5 个维度的信息"}}
```

## 注意

- 每次导入最多 10000 字符
- 如果你有大量信息，可以分多次导入
- 导入完成后告诉用户结果
"""
