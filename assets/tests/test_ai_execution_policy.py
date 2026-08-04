import os
import unittest
from unittest.mock import patch

from ai_execution_policy import require_ai_execution, resolve_ai_execution_policy


class AiExecutionPolicyTests(unittest.TestCase):
    def test_missing_and_unknown_modes_fail_closed(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                resolve_ai_execution_policy("https://model.example/v1").mode,
                "rules_only",
            )
            with self.assertRaisesRegex(RuntimeError, "rules_only"):
                require_ai_execution(
                    "https://model.example/v1",
                    data_classification="deidentified",
                )

        with patch.dict(os.environ, {"AI_EXECUTION_MODE": "unknown"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "rules_only"):
                require_ai_execution(
                    "https://model.example/v1",
                    data_classification="deidentified",
                )

    def test_approved_cloud_rejects_raw_resume(self) -> None:
        with patch.dict(os.environ, {"AI_EXECUTION_MODE": "approved_cloud"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "去标识化"):
                require_ai_execution(
                    "https://approved.example/v1",
                    data_classification="raw_resume",
                )

    def test_private_endpoint_rejects_known_public_model_host(self) -> None:
        with patch.dict(os.environ, {"AI_EXECUTION_MODE": "private_endpoint"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "私网主机"):
                require_ai_execution(
                    "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    data_classification="raw_resume",
                )

    def test_private_endpoint_accepts_only_private_or_exact_allowlisted_host(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_EXECUTION_MODE": "private_endpoint",
                "PRIVATE_LLM_ALLOWED_HOSTS": "model.customer.example",
            },
            clear=True,
        ):
            policy = require_ai_execution(
                "https://model.customer.example/v1",
                data_classification="raw_resume",
                tenant_mode="private_endpoint",
            )
            self.assertEqual(policy.mode, "private_endpoint")

    def test_tenant_rules_only_blocks_private_deployment(self) -> None:
        with patch.dict(os.environ, {"AI_EXECUTION_MODE": "private_endpoint"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "企业 AI 策略"):
                require_ai_execution(
                    "https://model.internal/v1",
                    data_classification="raw_resume",
                    tenant_mode="rules_only",
                )

    def test_approved_cloud_requires_https(self) -> None:
        with patch.dict(os.environ, {"AI_EXECUTION_MODE": "approved_cloud"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "HTTPS"):
                require_ai_execution(
                    "http://approved.example/v1",
                    data_classification="deidentified",
                )


if __name__ == "__main__":
    unittest.main()
