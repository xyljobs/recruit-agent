"""Fail-closed AI execution policy shared by legacy Python workers."""

from __future__ import annotations

import os
import ipaddress
from dataclasses import dataclass
from urllib.parse import urlparse


VALID_MODES = {"rules_only", "private_endpoint", "approved_cloud"}
@dataclass(frozen=True)
class AiExecutionPolicy:
    mode: str
    base_url: str


def resolve_ai_execution_policy(base_url: str) -> AiExecutionPolicy:
    configured = os.environ.get("AI_EXECUTION_MODE", "").strip().lower()
    mode = configured if configured in VALID_MODES else "rules_only"
    normalized_url = base_url.strip().rstrip("/")
    return AiExecutionPolicy(mode=mode, base_url=normalized_url)


def require_ai_execution(
    base_url: str,
    *,
    data_classification: str,
    tenant_mode: str | None = None,
) -> AiExecutionPolicy:
    policy = resolve_ai_execution_policy(base_url)
    if policy.mode == "rules_only":
        raise RuntimeError("AI_EXECUTION_MODE=rules_only，禁止调用模型或知识服务")
    if not policy.base_url:
        raise RuntimeError("当前 AI 模式未配置模型 Base URL")

    parsed = urlparse(policy.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("模型 Base URL 无效")
    if tenant_mode is not None and tenant_mode.strip().lower() != policy.mode:
        raise RuntimeError("企业 AI 策略未批准当前部署模式，按 rules_only 拒绝执行")
    if policy.mode == "private_endpoint" and not _is_allowed_private_host(parsed.hostname):
        raise RuntimeError("private_endpoint 必须使用私网主机或部署级精确白名单")
    if policy.mode == "approved_cloud" and parsed.scheme != "https":
        raise RuntimeError("approved_cloud 模型端点必须使用 HTTPS")
    if policy.mode == "approved_cloud" and data_classification != "deidentified":
        raise RuntimeError("approved_cloud 只允许发送去标识化数据，禁止发送原始简历或 PDF")
    return policy


def _is_allowed_private_host(hostname: str) -> bool:
    normalized = hostname.strip().lower().strip("[]")
    allowed_hosts = {
        value.strip().lower()
        for value in os.environ.get("PRIVATE_LLM_ALLOWED_HOSTS", "").split(",")
        if value.strip()
    }
    if normalized in allowed_hosts:
        return True
    if (
        normalized == "localhost"
        or normalized.endswith(".localhost")
        or normalized.endswith(".local")
        or normalized.endswith(".internal")
    ):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return address.is_private or address.is_loopback or address.is_link_local
