"""LangChain 1.x 的推荐写法:create_agent(内部就是一个编译好的 LangGraph 图)。

从这里 export `agent`,langgraph.json 的 graphs.agent 指到 "./src/agent.py:agent",
由 Agent Server(`langgraph dev`)加载并对外提供线程管理 + 流式 API——服务器我们
一行都不用写。

可观测性:Python 版 langsmith SDK 是真·零代码——设好 LANGSMITH_TRACING /
LANGSMITH_OTEL_ENABLED / LANGSMITH_OTEL_ONLY / OTEL_EXPORTER_OTLP_ENDPOINT 四个
环境变量(见 .env.example),import langchain 时自动挂 OTel hook,不像 JS 版还要
显式调一次 initializeOTEL()。所以这个项目没有 observability 模块。
"""

from __future__ import annotations

import os

from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

_SYSTEM_PROMPT = """你是一个乐于助人的中文 AI 助手。
需要天气信息时调用 get_weather,并用工具返回的数据作答,不要凭空编造天气。
需要精确计算时调用 calculate,把表达式交给它算,不要心算。
普通闲聊不要调用任何工具。回复保持中文、友好、简洁。"""

# ---------------------------------------------------------------------------
# 两个工具:get_weather(city) 和 calculate(expression)。
# ---------------------------------------------------------------------------

_KNOWN_CITIES: dict[str, tuple[str, int]] = {
    "北京": ("晴", 26),
    "上海": ("多云", 29),
    "广州": ("雷阵雨", 32),
    "深圳": ("阴", 31),
    "杭州": ("小雨", 28),
}
_CONDITIONS = ["晴", "多云", "阴", "小雨", "雷阵雨"]


@tool
def get_weather(city: str) -> dict:
    """查询某个城市当前的天气(演示用固定数据,不接外部 API)。需要实时天气时调用。"""
    key = city.strip()
    if key in _KNOWN_CITIES:
        condition, temp_c = _KNOWN_CITIES[key]
    else:
        # 未知城市按名字算确定性伪随机——同一个城市名永远得到同一个答案,方便复现。
        seed = sum(ord(ch) for ch in key)
        condition, temp_c = _CONDITIONS[seed % len(_CONDITIONS)], 15 + seed % 18
    return {
        "city": key,
        "condition": condition,
        "tempC": temp_c,
        "summary": f"{key}当前{condition},气温 {temp_c}°C。",
    }


def _calculate(expression: str) -> float:
    """只支持数字、+ - * / ( ) 的递归下降解析器——不用 eval(),非法字符直接抛错。"""
    allowed = set("0123456789.+-*/() ")
    if not expression or any(ch not in allowed for ch in expression):
        raise ValueError(f'表达式只能包含数字和 + - * / ( ):收到 "{expression}"')

    pos = 0

    def peek() -> str | None:
        return expression[pos] if pos < len(expression) else None

    def skip_spaces() -> None:
        nonlocal pos
        while peek() == " ":
            pos += 1

    def parse_number() -> float:
        nonlocal pos
        skip_spaces()
        start = pos
        while peek() is not None and (peek().isdigit() or peek() == "."):
            pos += 1
        if pos == start:
            raise ValueError(f'表达式在位置 {pos} 处缺少数字:"{expression}"')
        return float(expression[start:pos])

    def parse_factor() -> float:
        nonlocal pos
        skip_spaces()
        if peek() == "(":
            pos += 1
            value = parse_expr()
            skip_spaces()
            if peek() != ")":
                raise ValueError(f'表达式缺少右括号:"{expression}"')
            pos += 1
            return value
        if peek() == "-":
            pos += 1
            return -parse_factor()
        return parse_number()

    def parse_term() -> float:
        nonlocal pos
        value = parse_factor()
        while True:
            skip_spaces()
            op = peek()
            if op not in ("*", "/"):
                return value
            pos += 1
            rhs = parse_factor()
            value = value * rhs if op == "*" else value / rhs

    def parse_expr() -> float:
        nonlocal pos
        value = parse_term()
        while True:
            skip_spaces()
            op = peek()
            if op not in ("+", "-"):
                return value
            pos += 1
            rhs = parse_term()
            value = value + rhs if op == "+" else value - rhs

    result = parse_expr()
    skip_spaces()
    if pos != len(expression):
        raise ValueError(f'表达式在位置 {pos} 处有多余字符:"{expression}"')
    return result


@tool
def calculate(expression: str) -> dict:
    """计算一个只含数字和 + - * / ( ) 的算术表达式。需要精确计算时调用,不要心算。"""
    return {"expression": expression, "result": _calculate(expression)}


# ---------------------------------------------------------------------------
# agent 本体。不配 checkpointer:Agent Server 自己管线程持久化(thread = 会话),
# 本地 dev 模式存内存,重启服务器就丢——演示用足够了。
# ---------------------------------------------------------------------------

_llm = ChatOpenAI(
    model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
    base_url=os.getenv("OPENAI_BASE_URL") or None,
    api_key=os.getenv("OPENAI_API_KEY"),
)

agent = create_agent(
    model=_llm,
    tools=[get_weather, calculate],
    system_prompt=_SYSTEM_PROMPT,
)
